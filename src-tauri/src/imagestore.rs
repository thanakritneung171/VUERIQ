//! Decoded-image store: full-resolution pixels + mip pyramid, served to the renderer as tiles.
//!
//! * Decoding happens once per file (keyed by path + mtime + size) on a background thread.
//! * Level 0 is the original resolution; each further level halves both sides (Lanczos3).
//! * Images the viewer is showing are pinned; others (prefetched neighbours, recently viewed) are
//!   evicted LRU-first whenever the memory budget is exceeded, releasing their buffers.

use crate::decode::{self, Probe, Target};
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub const TILE_SIZE: u32 = 1024;
pub const TILE_OVERLAP: u32 = 1;

#[derive(Serialize, Clone, Copy)]
pub struct LevelInfo {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub id: u64,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub tile_size: u32,
    pub tile_overlap: u32,
    pub levels: Vec<LevelInfo>,
    pub render: &'static str,
    pub animated: bool,
    pub has_alpha: bool,
    pub format: String,
    pub decoder: String,
    pub decode_ms: u64,
    pub color_profile: Option<String>,
    pub color_managed: bool,
    pub orientation: u32,
    pub bit_depth: u8,
    pub notes: Vec<String>,
}

struct Level {
    w: u32,
    h: u32,
    data: Vec<u8>,
}

struct Entry {
    info: ImageInfo,
    levels: Vec<Level>,
    bytes: usize,
}

#[derive(Default)]
struct Inner {
    by_id: HashMap<u64, Arc<Entry>>,
    by_key: HashMap<String, u64>,
    last_used: HashMap<u64, u64>,
    pins: HashMap<u64, u32>,
    bytes: usize,
}

pub struct ImageStore {
    inner: Mutex<Inner>,
    key_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    budget: AtomicU64,
    next_id: AtomicU64,
    clock: AtomicU64,
}

fn cache_key(path: &Path) -> AppResult<String> {
    let md = std::fs::metadata(path)?;
    let mtime = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
    Ok(format!("{}|{}|{}", path.to_string_lossy().to_lowercase(), mtime, md.len()))
}

impl ImageStore {
    pub fn new(budget_bytes: u64) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            key_locks: Mutex::new(HashMap::new()),
            budget: AtomicU64::new(budget_bytes),
            next_id: AtomicU64::new(1),
            clock: AtomicU64::new(1),
        }
    }

    pub fn set_budget(&self, bytes: u64) {
        self.budget.store(bytes, Ordering::Relaxed);
        // Largest single image we accept ≈ 2/3 of the budget (pyramid adds 1/3), min 64 MP.
        decode::set_max_pixels(bytes * 2 / 3 / 4);
        self.evict();
    }

    pub fn stats(&self) -> (usize, usize, u64) {
        let g = self.inner.lock();
        (g.bytes, g.by_id.len(), self.budget.load(Ordering::Relaxed))
    }

    fn tick(&self) -> u64 {
        self.clock.fetch_add(1, Ordering::Relaxed)
    }

    /// Decode (or reuse) and pin. Blocking — call from a worker thread.
    pub fn open(&self, path: &Path, pin: bool) -> AppResult<ImageInfo> {
        // Animated & vector images are rendered by the WebView from the original bytes.
        if let Probe::Element { width, height, animated, format } = decode::probe(path)? {
            return Ok(ImageInfo {
                id: 0,
                path: path.to_string_lossy().into(),
                width,
                height,
                tile_size: TILE_SIZE,
                tile_overlap: 0,
                levels: vec![LevelInfo { width, height }],
                render: "element",
                animated,
                has_alpha: true,
                format: format.into(),
                decoder: if format == "SVG" { "WebView2 vector renderer".into() } else { "WebView2 (animation playback)".into() },
                decode_ms: 0,
                color_profile: None,
                color_managed: false,
                orientation: 1,
                bit_depth: 8,
                notes: vec![],
            });
        }

        let key = cache_key(path)?;
        let lock = self.key_locks.lock().entry(key.clone()).or_default().clone();
        let _guard = lock.lock();

        if let Some(info) = self.lookup(&key, pin) {
            return Ok(info);
        }

        let t0 = Instant::now();
        let d = decode::decode(path, Target::Full)?;
        let decode_ms = t0.elapsed().as_millis() as u64;
        let has_alpha = d.meta.has_alpha && decode::has_transparency(&d.rgba);
        let levels = build_pyramid(d.width, d.height, d.rgba, has_alpha)?;
        let bytes = levels.iter().map(|l| l.data.len()).sum();

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let info = ImageInfo {
            id,
            path: path.to_string_lossy().into(),
            width: d.width,
            height: d.height,
            tile_size: TILE_SIZE,
            tile_overlap: TILE_OVERLAP,
            levels: levels.iter().map(|l| LevelInfo { width: l.w, height: l.h }).collect(),
            render: "tiles",
            animated: false,
            has_alpha,
            format: d.meta.format,
            decoder: d.meta.decoder,
            decode_ms,
            color_profile: d.meta.color_profile,
            color_managed: d.meta.color_managed,
            orientation: d.meta.orientation,
            bit_depth: d.meta.bit_depth,
            notes: d.meta.notes,
        };
        {
            let mut g = self.inner.lock();
            g.by_id.insert(id, Arc::new(Entry { info: info.clone(), levels, bytes }));
            g.by_key.insert(key.clone(), id);
            g.bytes += bytes;
            let now = self.tick();
            g.last_used.insert(id, now);
            if pin {
                *g.pins.entry(id).or_default() += 1;
            }
        }
        self.key_locks.lock().remove(&key);
        self.evict();
        Ok(info)
    }

    fn lookup(&self, key: &str, pin: bool) -> Option<ImageInfo> {
        let mut g = self.inner.lock();
        let id = *g.by_key.get(key)?;
        let info = g.by_id.get(&id)?.info.clone();
        let now = self.tick();
        g.last_used.insert(id, now);
        if pin {
            *g.pins.entry(id).or_default() += 1;
        }
        Some(info)
    }

    pub fn release(&self, id: u64) {
        let mut g = self.inner.lock();
        if let Some(c) = g.pins.get_mut(&id) {
            *c = c.saturating_sub(1);
            if *c == 0 {
                g.pins.remove(&id);
            }
        }
        drop(g);
        self.evict();
    }

    fn evict(&self) {
        let budget = self.budget.load(Ordering::Relaxed) as usize;
        let mut g = self.inner.lock();
        while g.bytes > budget {
            let victim = g
                .last_used
                .iter()
                .filter(|(id, _)| !g.pins.contains_key(id))
                .min_by_key(|(_, t)| **t)
                .map(|(id, _)| *id);
            let Some(id) = victim else { break };
            if let Some(e) = g.by_id.remove(&id) {
                g.bytes -= e.bytes;
            }
            g.last_used.remove(&id);
            g.by_key.retain(|_, v| *v != id);
        }
    }

    /// RGBA8 bytes of a tile including its overlap border.
    pub fn tile(&self, id: u64, level: usize, tx: u32, ty: u32) -> AppResult<Vec<u8>> {
        let entry = {
            let mut g = self.inner.lock();
            let e = g.by_id.get(&id).cloned().ok_or_else(|| AppError::other("image no longer in memory"))?;
            let now = self.tick();
            g.last_used.insert(id, now);
            e
        };
        let l = entry.levels.get(level).ok_or_else(|| AppError::other("bad level"))?;
        let x0 = (tx * TILE_SIZE).saturating_sub(TILE_OVERLAP);
        let y0 = (ty * TILE_SIZE).saturating_sub(TILE_OVERLAP);
        if tx * TILE_SIZE >= l.w || ty * TILE_SIZE >= l.h {
            return Err(AppError::other("tile out of range"));
        }
        let x1 = ((tx + 1) * TILE_SIZE + TILE_OVERLAP).min(l.w);
        let y1 = ((ty + 1) * TILE_SIZE + TILE_OVERLAP).min(l.h);
        let row = (x1 - x0) as usize * 4;
        let mut out = Vec::with_capacity(row * (y1 - y0) as usize);
        let stride = l.w as usize * 4;
        for y in y0..y1 {
            let s = y as usize * stride + x0 as usize * 4;
            out.extend_from_slice(&l.data[s..s + row]);
        }
        Ok(out)
    }

    pub fn path_of(&self, id: u64) -> Option<PathBuf> {
        self.inner.lock().by_id.get(&id).map(|e| PathBuf::from(&e.info.path))
    }
}

fn build_pyramid(w: u32, h: u32, rgba: Vec<u8>, has_alpha: bool) -> AppResult<Vec<Level>> {
    let mut levels = vec![Level { w, h, data: rgba }];
    loop {
        let last = levels.last().unwrap();
        if last.w <= TILE_SIZE && last.h <= TILE_SIZE {
            break;
        }
        let nw = last.w.div_ceil(2).max(1);
        let nh = last.h.div_ceil(2).max(1);
        let data = decode::resize_rgba(&last.data, last.w, last.h, nw, nh, has_alpha);
        levels.push(Level { w: nw, h: nh, data });
    }
    Ok(levels)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pyramid_halves_until_one_tile() {
        let w = 5000;
        let h = 3000;
        let levels = build_pyramid(w, h, vec![128; (w * h * 4) as usize], false).unwrap();
        let dims: Vec<_> = levels.iter().map(|l| (l.w, l.h)).collect();
        assert_eq!(dims, vec![(5000, 3000), (2500, 1500), (1250, 750), (625, 375)]);
        assert!(levels.iter().all(|l| l.data.len() == (l.w * l.h * 4) as usize));
    }
}
