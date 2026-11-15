//! Asynchronous, disk-cached thumbnails — completely separate from full-resolution rendering.
//!
//! Cache key = xxh3(path, mtime, size, requested bucket, cache version). Files live under
//! `%LOCALAPPDATA%\VUERIQ\cache\thumbs\ab\<hash>.jpg|png`.

use crate::decode::{self, fit_within, Target};
use crate::error::{AppError, AppResult};
use crate::formats::{self, Engine};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

const CACHE_VERSION: u32 = 3;

pub struct ThumbCache {
    dir: PathBuf,
    pool: rayon::ThreadPool,
    video_gate: Arc<Mutex<()>>,
}

pub struct Thumb {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

impl ThumbCache {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_sub(2).clamp(2, 6);
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .thread_name(|i| format!("vq-thumb-{i}"))
            .build()
            .expect("thumbnail pool");
        Self { dir, pool, video_gate: Arc::new(Mutex::new(())) }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn spawn<F: FnOnce() + Send + 'static>(&self, f: F) {
        self.pool.spawn(f);
    }

    fn key_path(&self, path: &Path, size: u32) -> AppResult<(PathBuf, PathBuf)> {
        let md = std::fs::metadata(path)?;
        let mtime = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
        let key = format!("{}|{}|{}|{}|v{}", path.to_string_lossy().to_lowercase(), mtime, md.len(), size, CACHE_VERSION);
        let h = xxhash_rust::xxh3::xxh3_128(key.as_bytes());
        let hex = format!("{h:032x}");
        let sub = self.dir.join(&hex[..2]);
        Ok((sub.join(format!("{hex}.jpg")), sub.join(format!("{hex}.png"))))
    }

    /// Blocking. Returns cached bytes or generates them.
    pub fn get(&self, path: &Path, size: u32) -> AppResult<Thumb> {
        let size = size.clamp(64, 1024);
        let (jpg, png) = self.key_path(path, size)?;
        if let Ok(b) = std::fs::read(&jpg) {
            return Ok(Thumb { bytes: b, mime: "image/jpeg" });
        }
        if let Ok(b) = std::fs::read(&png) {
            return Ok(Thumb { bytes: b, mime: "image/png" });
        }
        let thumb = self.generate(path, size)?;
        if let Some(parent) = jpg.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let target = if thumb.mime == "image/png" { png } else { jpg };
        // Write atomically so a crash never leaves a truncated cache file.
        let tmp = target.with_extension("tmp");
        if std::fs::write(&tmp, &thumb.bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &target);
        }
        Ok(thumb)
    }

    fn generate(&self, path: &Path, size: u32) -> AppResult<Thumb> {
        match formats::engine_for(path) {
            Some(Engine::Video) => {
                // libmpv thumbnailing is heavier; at most two at a time.
                let _g = self.video_gate.lock();
                let tmpdir = self.dir.join("_video_tmp").join(format!("{:x}", xxhash_rust::xxh3::xxh3_64(path.to_string_lossy().as_bytes())));
                let jpg = crate::video::thumbnail(path, size, &tmpdir)?;
                Ok(Thumb { bytes: jpg, mime: "image/jpeg" })
            }
            Some(_) => {
                let d = decode::decode(path, Target::Thumb(size))?;
                let (tw, th) = fit_within(d.width, d.height, size);
                let has_alpha = d.meta.has_alpha && decode::has_transparency(&d.rgba);
                let px = if (tw, th) == (d.width, d.height) {
                    d.rgba
                } else {
                    decode::resize_rgba(&d.rgba, d.width, d.height, tw, th, has_alpha)
                };
                encode(px, tw, th, has_alpha)
            }
            None => Err(AppError::unsupported(&formats::ext_of(path))),
        }
    }

    pub fn clear(&self) -> u64 {
        let mut freed = 0u64;
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                freed += dir_size(&e.path());
                let _ = if e.path().is_dir() { std::fs::remove_dir_all(e.path()) } else { std::fs::remove_file(e.path()) };
            }
        }
        freed
    }

    pub fn stats(&self) -> (u64, u64) {
        let mut files = 0u64;
        let mut bytes = 0u64;
        walk(&self.dir, &mut |p| {
            if let Ok(m) = std::fs::metadata(p) {
                files += 1;
                bytes += m.len();
            }
        });
        (bytes, files)
    }
}

fn encode(px: Vec<u8>, w: u32, h: u32, has_alpha: bool) -> AppResult<Thumb> {
    let mut out = Vec::new();
    if has_alpha {
        let img = image::RgbaImage::from_raw(w, h, px).ok_or_else(|| AppError::other("thumbnail buffer"))?;
        img.write_with_encoder(image::codecs::png::PngEncoder::new_with_quality(
            &mut out,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Adaptive,
        ))?;
        Ok(Thumb { bytes: out, mime: "image/png" })
    } else {
        let rgb: Vec<u8> = px.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
        let img = image::RgbImage::from_raw(w, h, rgb).ok_or_else(|| AppError::other("thumbnail buffer"))?;
        img.write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 88))?;
        Ok(Thumb { bytes: out, mime: "image/jpeg" })
    }
}

fn walk(dir: &Path, f: &mut dyn FnMut(&Path)) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, f);
            } else {
                f(&p);
            }
        }
    }
}

fn dir_size(p: &Path) -> u64 {
    if p.is_file() {
        return std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0;
    walk(p, &mut |f| total += std::fs::metadata(f).map(|m| m.len()).unwrap_or(0));
    total
}
