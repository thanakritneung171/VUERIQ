//! Duplicate finder.
//!
//! * **Exact** duplicates: same size → same quick hash (first/last 64 KiB) → same full xxh3 hash.
//!   Works for every image and video format.
//! * **Similar** images: a 64-bit difference hash (dHash) of the decoded, orientation-corrected
//!   picture. Catches the same photo re-saved, resized, re-compressed or converted (HEIC ↔ JPEG).
//!   Pairs must have a similar aspect ratio and a Hamming distance ≤ threshold.
//!
//! Hashing runs in parallel; progress is reported through a callback and the scan can be cancelled.

use crate::decode::{self, Target};
use crate::formats::{self, MediaKind};
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Instant, UNIX_EPOCH};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DupFile {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub kind: MediaKind,
    pub size: u64,
    pub modified: u64,
    /// Pixel size (images whose header could be read cheaply).
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DupGroup {
    /// "exact" (byte-identical) or "similar" (looks the same).
    pub kind: &'static str,
    /// Largest file first.
    pub files: Vec<DupFile>,
    /// Bytes freed by keeping only the largest file.
    pub reclaimable: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DupReport {
    pub root: String,
    pub scanned: usize,
    /// Images that could not be decoded for the similarity check (still checked for exact copies).
    pub unreadable: usize,
    pub groups: Vec<DupGroup>,
    pub cancelled: bool,
    pub elapsed_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct ScanOptions {
    pub recursive: bool,
    pub similar: bool,
    /// Max differing bits out of 64 for "similar".
    pub threshold: u32,
}

static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// (path lowercase) → (mtime, size, hash)
type HashCache = Mutex<HashMap<String, (u64, u64, Option<Visual>)>>;
fn visual_cache() -> &'static HashCache {
    static C: OnceLock<HashCache> = OnceLock::new();
    C.get_or_init(Default::default)
}

#[derive(Clone, Copy, Debug)]
struct Visual {
    hash: u64,
    aspect: f32,
}

struct Entry {
    path: PathBuf,
    kind: MediaKind,
    size: u64,
    modified: u64,
}

// ───────────────────────── listing ─────────────────────────

fn list_media(root: &Path, recursive: bool, files: &mut Vec<Entry>) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if CANCEL.load(Ordering::Relaxed) {
            return;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.starts_with('$') {
                continue;
            }
            // symlink_metadata: never follow links / junctions (no loops).
            let Ok(md) = std::fs::symlink_metadata(e.path()) else { continue };
            if crate::fsx::is_hidden(&md) || md.file_type().is_symlink() {
                continue;
            }
            let p = e.path();
            if md.is_dir() {
                if recursive {
                    stack.push(p);
                }
            } else if let Some(kind) = formats::kind_for(&p) {
                let modified = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                files.push(Entry { path: p, kind, size: md.len(), modified });
            }
        }
    }
}

// ───────────────────────── hashing ─────────────────────────

const QUICK: u64 = 64 * 1024;

fn quick_hash(path: &Path, size: u64) -> Option<u64> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut h = xxhash_rust::xxh3::Xxh3::new();
    h.update(&size.to_le_bytes());
    let mut buf = vec![0u8; QUICK.min(size) as usize];
    f.read_exact(&mut buf).ok()?;
    h.update(&buf);
    if size > QUICK * 2 {
        f.seek(SeekFrom::End(-(QUICK as i64))).ok()?;
        f.read_exact(&mut buf).ok()?;
        h.update(&buf);
    }
    Some(h.digest())
}

fn full_hash(path: &Path) -> Option<u128> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut h = xxhash_rust::xxh3::Xxh3::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if CANCEL.load(Ordering::Relaxed) {
            return None;
        }
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(h.digest128())
}

/// dHash of a grey 9×8 version of the picture. `None` for unreadable or near-flat images
/// (flat images all hash alike, so they are only matched as exact copies).
pub fn visual_hash(path: &Path) -> Option<(u64, f32)> {
    let d = decode::decode(path, Target::Thumb(64)).ok()?;
    if d.width == 0 || d.height == 0 {
        return None;
    }
    let small = decode::resize_rgba(&d.rgba, d.width, d.height, 9, 8, false);
    let grey: Vec<f32> = small.chunks_exact(4).map(|p| 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32).collect();
    let mean = grey.iter().sum::<f32>() / grey.len() as f32;
    let var = grey.iter().map(|g| (g - mean) * (g - mean)).sum::<f32>() / grey.len() as f32;
    if var.sqrt() < 4.0 {
        return None;
    }
    let mut hash = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            if grey[y * 9 + x] > grey[y * 9 + x + 1] {
                hash |= 1 << (y * 8 + x);
            }
        }
    }
    Some((hash, d.width as f32 / d.height as f32))
}

fn cached_visual(e: &Entry) -> Option<Visual> {
    let key = e.path.to_string_lossy().to_lowercase();
    if let Some((m, s, v)) = visual_cache().lock().get(&key) {
        if *m == e.modified && *s == e.size {
            return *v;
        }
    }
    let v = visual_hash(&e.path).map(|(hash, aspect)| Visual { hash, aspect });
    visual_cache().lock().insert(key, (e.modified, e.size, v));
    v
}

// ───────────────────────── grouping ─────────────────────────

struct Dsu(Vec<usize>);
impl Dsu {
    fn find(&mut self, mut x: usize) -> usize {
        while self.0[x] != x {
            self.0[x] = self.0[self.0[x]];
            x = self.0[x];
        }
        x
    }
    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.0[rb] = ra;
        }
    }
}

pub fn scan(root: &Path, opts: ScanOptions, progress: &(dyn Fn(Progress) + Sync)) -> DupReport {
    CANCEL.store(false, Ordering::SeqCst);
    let t0 = Instant::now();
    let mut report = DupReport { root: root.to_string_lossy().into(), ..Default::default() };

    progress(Progress { phase: "listing", done: 0, total: 0 });
    let mut files = vec![];
    list_media(root, opts.recursive, &mut files);
    report.scanned = files.len();
    let n = files.len();
    let mut dsu = Dsu((0..n).collect());
    let mut full: Vec<Option<u128>> = vec![None; n];

    // ── exact: size → quick hash → full hash ──
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, f) in files.iter().enumerate() {
        if f.size > 0 {
            by_size.entry(f.size).or_default().push(i);
        }
    }
    let candidates: Vec<usize> = by_size.values().filter(|v| v.len() > 1).flatten().copied().collect();
    let done = AtomicUsize::new(0);
    let total_exact = candidates.len();
    let quick: Vec<(usize, Option<u64>)> = candidates
        .par_iter()
        .map(|&i| {
            let q = if CANCEL.load(Ordering::Relaxed) { None } else { quick_hash(&files[i].path, files[i].size) };
            let d = done.fetch_add(1, Ordering::Relaxed) + 1;
            if d % 16 == 0 || d == total_exact {
                progress(Progress { phase: "comparing", done: d, total: total_exact });
            }
            (i, q)
        })
        .collect();
    let mut by_quick: HashMap<(u64, u64), Vec<usize>> = HashMap::new();
    for (i, q) in quick {
        if let Some(q) = q {
            by_quick.entry((files[i].size, q)).or_default().push(i);
        }
    }
    let need_full: Vec<usize> = by_quick.values().filter(|v| v.len() > 1).flatten().copied().collect();
    let fulls: Vec<(usize, Option<u128>)> = need_full.par_iter().map(|&i| (i, full_hash(&files[i].path))).collect();
    let mut by_full: HashMap<(u64, u128), Vec<usize>> = HashMap::new();
    for (i, h) in fulls {
        if let Some(h) = h {
            full[i] = Some(h);
            by_full.entry((files[i].size, h)).or_default().push(i);
        }
    }
    for g in by_full.values().filter(|v| v.len() > 1) {
        for &j in &g[1..] {
            dsu.union(g[0], j);
        }
    }

    // ── similar images ──
    if opts.similar && !CANCEL.load(Ordering::Relaxed) {
        let images: Vec<usize> = (0..n).filter(|&i| files[i].kind == MediaKind::Image).collect();
        let done = AtomicUsize::new(0);
        let total = images.len();
        progress(Progress { phase: "analyzing", done: 0, total });
        let visuals: Vec<(usize, Option<Visual>)> = images
            .par_iter()
            .map(|&i| {
                let v = if CANCEL.load(Ordering::Relaxed) { None } else { cached_visual(&files[i]) };
                let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                if d % 8 == 0 || d == total {
                    progress(Progress { phase: "analyzing", done: d, total });
                }
                (i, v)
            })
            .collect();
        report.unreadable = visuals.iter().filter(|(_, v)| v.is_none()).count();
        let mut vs: Vec<(usize, Visual)> = visuals.into_iter().filter_map(|(i, v)| v.map(|v| (i, v))).collect();
        // Sort by aspect so only neighbours within ±6 % need comparing.
        vs.sort_by(|a, b| a.1.aspect.total_cmp(&b.1.aspect));
        for a in 0..vs.len() {
            if CANCEL.load(Ordering::Relaxed) {
                break;
            }
            let (ia, va) = vs[a];
            for &(ib, vb) in &vs[a + 1..] {
                if vb.aspect > va.aspect * 1.06 {
                    break;
                }
                if (va.hash ^ vb.hash).count_ones() <= opts.threshold {
                    dsu.union(ia, ib);
                }
            }
        }
    }

    report.cancelled = CANCEL.load(Ordering::Relaxed);
    if report.cancelled {
        report.elapsed_ms = t0.elapsed().as_millis() as u64;
        return report;
    }

    // ── build groups ──
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let r = dsu.find(i);
        groups.entry(r).or_default().push(i);
    }
    let mut out: Vec<DupGroup> = groups
        .into_values()
        .filter(|g| g.len() > 1)
        .map(|mut g| {
            g.sort_by(|&a, &b| files[b].size.cmp(&files[a].size).then(files[a].modified.cmp(&files[b].modified)));
            let exact = g.iter().all(|&i| full[i].is_some() && full[i] == full[g[0]]);
            let total: u64 = g.iter().map(|&i| files[i].size).sum();
            DupGroup {
                kind: if exact { "exact" } else { "similar" },
                reclaimable: total - files[g[0]].size,
                files: g.iter().map(|&i| to_dup(&files[i])).collect(),
            }
        })
        .collect();
    out.sort_by(|a, b| b.reclaimable.cmp(&a.reclaimable));
    report.groups = out;
    report.elapsed_ms = t0.elapsed().as_millis() as u64;
    report
}

fn to_dup(e: &Entry) -> DupFile {
    let (width, height) = match e.kind {
        MediaKind::Image => image::image_dimensions(&e.path).map(|(w, h)| (Some(w), Some(h))).unwrap_or((None, None)),
        MediaKind::Video => (None, None),
    };
    DupFile {
        path: e.path.to_string_lossy().into(),
        name: e.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        ext: formats::ext_of(&e.path),
        kind: e.kind,
        size: e.size,
        modified: e.modified,
        width,
        height,
    }
}
