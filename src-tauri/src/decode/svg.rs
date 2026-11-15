//! SVG: displayed as vector by the WebView (crisp at every zoom); rasterised with resvg for thumbnails.

use super::{DecodeMeta, Decoded, Target};
use crate::error::{AppError, AppResult};
use resvg::{tiny_skia, usvg};
use std::path::Path;

fn load(path: &Path) -> AppResult<usvg::Tree> {
    let data = std::fs::read(path)?;
    let mut opt = usvg::Options::default();
    opt.resources_dir = path.parent().map(|p| p.to_path_buf());
    opt.fontdb_mut().load_system_fonts();
    usvg::Tree::from_data(&data, &opt).map_err(|e| AppError::corrupt(e))
}

pub fn svg_size(path: &Path) -> AppResult<(u32, u32)> {
    let data = std::fs::read(path)?;
    let tree = usvg::Tree::from_data(&data, &usvg::Options::default()).map_err(|e| AppError::corrupt(e))?;
    let s = tree.size();
    Ok(((s.width().ceil() as u32).max(1), (s.height().ceil() as u32).max(1)))
}

pub fn render_svg(path: &Path, max: u32) -> AppResult<Decoded> {
    let tree = load(path)?;
    let s = tree.size();
    // Scale to the requested size in both directions: vectors scale losslessly.
    let scale = max as f32 / s.width().max(s.height()).max(1.0);
    let (w, h) = (((s.width() * scale).round() as u32).max(1), ((s.height() * scale).round() as u32).max(1));
    let mut pixmap = tiny_skia::Pixmap::new(w, h).ok_or_else(|| AppError::corrupt("invalid SVG size"))?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    // tiny-skia is premultiplied → straight alpha
    let mut data = pixmap.take();
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a != 0 && a != 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    Decoded::new(
        w,
        h,
        data,
        DecodeMeta { format: "SVG".into(), decoder: "resvg".into(), orientation: 1, bit_depth: 8, has_alpha: true, ..Default::default() },
    )
}

pub fn decode(path: &Path, target: Target) -> AppResult<Decoded> {
    let max = match target {
        Target::Thumb(m) => m,
        Target::Full => 4096,
    };
    render_svg(path, max)
}
