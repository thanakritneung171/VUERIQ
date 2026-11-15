//! Native image decoding. Every decoder produces straight-alpha RGBA8 in sRGB with EXIF/container
//! orientation already applied, so the renderer never has to care about the source format.

mod heif;
mod jxl;
mod raw;
mod standard;
mod svg;

use crate::error::{AppError, AppResult};
use crate::formats::{self, Engine};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

pub use svg::{svg_size, render_svg};

/// Upper bound on decoded pixels (RGBA8 → 4 bytes each). Adjusted from the memory setting.
static MAX_PIXELS: AtomicU64 = AtomicU64::new(400_000_000);

pub fn set_max_pixels(px: u64) {
    MAX_PIXELS.store(px.max(64_000_000), Ordering::Relaxed);
}

pub fn max_pixels() -> u64 {
    MAX_PIXELS.load(Ordering::Relaxed)
}

pub fn check_size(w: u64, h: u64) -> AppResult<()> {
    if w == 0 || h == 0 {
        return Err(AppError::corrupt("image has zero width or height"));
    }
    if w.saturating_mul(h) > max_pixels() {
        return Err(AppError::too_large(w, h));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// Full resolution — the viewer.
    Full,
    /// Anything at least this big on the long side is fine — thumbnails.
    Thumb(u32),
}

#[derive(Debug, Clone, Default)]
pub struct DecodeMeta {
    pub format: String,
    pub decoder: String,
    pub color_profile: Option<String>,
    pub color_managed: bool,
    pub orientation: u32,
    pub bit_depth: u8,
    pub has_alpha: bool,
    pub notes: Vec<String>,
}

pub struct Decoded {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub meta: DecodeMeta,
}

impl Decoded {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>, meta: DecodeMeta) -> AppResult<Self> {
        if rgba.len() != width as usize * height as usize * 4 {
            return Err(AppError::corrupt(format!("decoder returned {} bytes for {}×{}", rgba.len(), width, height)));
        }
        Ok(Self { width, height, rgba, meta })
    }
}

/// How the frontend should render a file.
pub enum Probe {
    /// Decode natively → tiles.
    Native,
    /// Let the WebView render the original bytes (animations, vector SVG).
    Element { width: u32, height: u32, animated: bool, format: &'static str },
}

fn resolve_engine(path: &Path) -> AppResult<Engine> {
    let by_ext = formats::engine_for(path);
    // Trust content over extension when they disagree (e.g. HEIC renamed to .jpg).
    match (by_ext, formats::sniff(path)) {
        (Some(Engine::Svg), _) => Ok(Engine::Svg),
        (Some(Engine::Raw), _) => Ok(Engine::Raw),
        (_, Some(Engine::Video)) if by_ext != Some(Engine::Video) && by_ext != Some(Engine::Heif) => {
            Err(AppError::unsupported(&formats::ext_of(path)))
        }
        (_, Some(sniffed)) if sniffed != Engine::Video => Ok(sniffed),
        (Some(e), _) => Ok(e),
        (None, _) => Err(AppError::unsupported(&formats::ext_of(path))),
    }
}

pub fn probe(path: &Path) -> AppResult<Probe> {
    if !path.exists() {
        return Err(std::io::Error::from(std::io::ErrorKind::NotFound).into());
    }
    match resolve_engine(path)? {
        Engine::Svg => {
            let (w, h) = svg_size(path)?;
            Ok(Probe::Element { width: w, height: h, animated: false, format: "SVG" })
        }
        Engine::Standard => standard::probe_animation(path),
        _ => Ok(Probe::Native),
    }
}

pub fn decode(path: &Path, target: Target) -> AppResult<Decoded> {
    let engine = resolve_engine(path)?;
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match engine {
        Engine::Standard => standard::decode(path, target),
        Engine::Heif => heif::decode(path, target),
        Engine::Jxl => jxl::decode(path, target),
        Engine::Raw => raw::decode(path, target),
        Engine::Svg => svg::decode(path, target),
        Engine::Video => Err(AppError::unsupported(&formats::ext_of(path))),
    }));
    match res {
        Ok(r) => r,
        // A malformed file must never take the app down: decoder panics become "corrupt" errors.
        Err(p) => {
            let msg = p
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| p.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "decoder panicked".into());
            Err(AppError::corrupt(msg))
        }
    }
}

pub fn libheif_version() -> Option<String> {
    heif::version()
}

pub fn libheif_plugins() -> Vec<String> {
    heif::loaded_plugins()
}

// ───────────── helpers shared by decoders ─────────────

/// Apply an EXIF orientation (1..=8) to an RGBA buffer.
pub fn apply_orientation(img: image::RgbaImage, orientation: u32) -> image::RgbaImage {
    use image::imageops;
    match orientation {
        2 => imageops::flip_horizontal(&img),
        3 => imageops::rotate180(&img),
        4 => imageops::flip_vertical(&img),
        5 => imageops::flip_horizontal(&imageops::rotate90(&img)),
        6 => imageops::rotate90(&img),
        7 => imageops::flip_horizontal(&imageops::rotate270(&img)),
        8 => imageops::rotate270(&img),
        _ => img,
    }
}

pub fn orientation_to_exif(o: image::metadata::Orientation) -> u32 {
    use image::metadata::Orientation as O;
    match o {
        O::NoTransforms => 1,
        O::FlipHorizontal => 2,
        O::Rotate180 => 3,
        O::FlipVertical => 4,
        O::Rotate90FlipH => 5,
        O::Rotate90 => 6,
        O::Rotate270FlipH => 7,
        O::Rotate270 => 8,
    }
}

/// High-quality resize (Lanczos3, alpha-aware) using SIMD.
pub fn resize_rgba(src: &[u8], w: u32, h: u32, dw: u32, dh: u32, has_alpha: bool) -> Vec<u8> {
    use fast_image_resize as fr;
    let dw = dw.max(1);
    let dh = dh.max(1);
    let src_img = match fr::images::ImageRef::new(w, h, src, fr::PixelType::U8x4) {
        Ok(i) => i,
        Err(_) => return vec![0; (dw * dh * 4) as usize],
    };
    let mut dst = fr::images::Image::new(dw, dh, fr::PixelType::U8x4);
    let mut resizer = fr::Resizer::new();
    let opts = fr::ResizeOptions::new()
        .resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Lanczos3))
        .use_alpha(has_alpha);
    if resizer.resize(&src_img, &mut dst, &opts).is_err() {
        return vec![0; (dw * dh * 4) as usize];
    }
    dst.into_vec()
}

/// Fit (w,h) inside a square of `max` keeping aspect.
pub fn fit_within(w: u32, h: u32, max: u32) -> (u32, u32) {
    if w <= max && h <= max {
        return (w, h);
    }
    let s = max as f64 / w.max(h) as f64;
    (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
}

pub fn has_transparency(rgba: &[u8]) -> bool {
    rgba.chunks_exact(4).any(|p| p[3] != 255)
}
