//! JPEG XL via jxl-oxide (pure Rust). Output is requested in sRGB.

use super::{check_size, DecodeMeta, Decoded, Target};
use crate::error::{AppError, AppResult};
use jxl_oxide::{EnumColourEncoding, JxlImage, RenderingIntent};
use std::path::Path;

pub fn decode(path: &Path, _target: Target) -> AppResult<Decoded> {
    let mut image = JxlImage::builder().open(path).map_err(|e| AppError::corrupt(e))?;
    let (w, h) = (image.width(), image.height());
    check_size(w as u64, h as u64)?;
    let has_icc = image.original_icc().is_some();
    image.request_color_encoding(EnumColourEncoding::srgb(RenderingIntent::Relative));
    let bit_depth = image.image_header().metadata.bit_depth.bits_per_sample() as u8;
    let render = image.render_frame(0).map_err(|e| AppError::corrupt(e))?;
    let mut stream = render.stream();
    let (sw, sh, ch) = (stream.width(), stream.height(), stream.channels() as usize);
    let mut buf = vec![0u8; sw as usize * sh as usize * ch];
    stream.write_to_buffer::<u8>(&mut buf);
    let rgba: Vec<u8> = match ch {
        1 => buf.iter().flat_map(|&l| [l, l, l, 255]).collect(),
        2 => buf.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        3 => buf.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        4 => buf,
        n => return Err(AppError::corrupt(format!("unexpected channel count {n}"))),
    };
    let has_alpha = ch == 2 || ch == 4;
    let mut meta = DecodeMeta {
        format: "JPEG XL".into(),
        decoder: "jxl-oxide".into(),
        color_managed: true,
        color_profile: Some(if has_icc { "Embedded ICC → sRGB".into() } else { "sRGB".into() }),
        orientation: image.image_header().metadata.orientation,
        bit_depth,
        has_alpha,
        ..Default::default()
    };
    if image.num_loaded_keyframes() > 1 {
        meta.notes.push("Animated JPEG XL: showing the first frame".into());
    }
    Decoded::new(sw, sh, rgba, meta)
}
