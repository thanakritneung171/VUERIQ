//! Camera RAW via rawler (CR2, CR3, NEF, ARW, DNG, ORF, RAF, RW2, PEF, …).
//!
//! Strategy: if the file embeds a camera-rendered JPEG at (nearly) full sensor resolution we show
//! that — it carries the camera's own colour rendition. Otherwise the raw data is developed
//! (demosaic → white balance → camera matrix → sRGB).

use super::{apply_orientation, check_size, DecodeMeta, Decoded, Target};
use crate::error::{AppError, AppResult, ErrorKind};
use rawler::decoders::RawDecodeParams;
use rawler::imgop::develop::RawDevelop;
use rawler::rawsource::RawSource;
use std::path::Path;

fn map_err(e: rawler::RawlerError) -> AppError {
    let msg = e.to_string();
    let l = msg.to_ascii_lowercase();
    if l.contains("camera") && (l.contains("unknown") || l.contains("not supported") || l.contains("couldn't find")) || l.contains("unsupported") {
        AppError::new(
            ErrorKind::UnsupportedFormat,
            "This RAW file comes from a camera model or compression mode that isn't supported yet.",
        )
        .with_detail(msg)
    } else {
        AppError::corrupt(msg)
    }
}

pub fn decode(path: &Path, target: Target) -> AppResult<Decoded> {
    let src = RawSource::new(path)?;
    let decoder = rawler::get_decoder(&src).map_err(map_err)?;
    let params = RawDecodeParams::default();
    let md = decoder.raw_metadata(&src, &params).ok();
    let orientation = md.as_ref().and_then(|m| m.exif.orientation).map(|o| o as u32).unwrap_or(1);
    let camera = md.as_ref().map(|m| format!("{} {}", m.make, m.model).trim().to_string()).unwrap_or_default();

    // Sensor size (cheap: dummy decode reads headers only).
    let sensor = decoder.raw_image(&src, &params, true).ok().map(|r| (r.width as u32, r.height as u32));

    let mut note = String::new();
    let img: image::DynamicImage = match target {
        Target::Thumb(max) => {
            let mut best = None;
            for f in [decoder.thumbnail_image(&src, &params), decoder.preview_image(&src, &params), decoder.full_image(&src, &params)] {
                if let Ok(Some(i)) = f {
                    if i.width().max(i.height()) >= max {
                        best = Some(i);
                        break;
                    }
                    best.get_or_insert(i);
                }
            }
            match best {
                Some(i) => i,
                None => develop(&*decoder, &src, &params)?,
            }
        }
        Target::Full => {
            let embedded = decoder.full_image(&src, &params).ok().flatten();
            let big_enough = |i: &image::DynamicImage| match sensor {
                Some((sw, sh)) => i.width().max(i.height()) as f32 >= sw.max(sh) as f32 * 0.85,
                None => true,
            };
            match embedded {
                Some(i) if big_enough(&i) => {
                    note = "Camera-rendered full-size image embedded in the RAW file".into();
                    i
                }
                _ => {
                    note = "Developed from raw sensor data".into();
                    develop(&*decoder, &src, &params)?
                }
            }
        }
    };

    check_size(img.width() as u64, img.height() as u64)?;
    let bit_depth = match img.color() {
        image::ColorType::Rgb16 | image::ColorType::Rgba16 | image::ColorType::L16 => 16,
        _ => 8,
    };
    let rgba = apply_orientation(img.into_rgba8(), orientation);
    let (w, h) = rgba.dimensions();
    let mut meta = DecodeMeta {
        format: format!("Camera RAW ({})", path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_uppercase()),
        decoder: "rawler".into(),
        color_managed: true,
        color_profile: Some("sRGB".into()),
        orientation,
        bit_depth,
        has_alpha: false,
        notes: vec![],
    };
    if !note.is_empty() {
        meta.notes.push(note);
    }
    if !camera.is_empty() {
        meta.notes.push(format!("Camera: {camera}"));
    }
    Decoded::new(w, h, rgba.into_raw(), meta)
}

fn develop(decoder: &dyn rawler::decoders::Decoder, src: &RawSource, params: &RawDecodeParams) -> AppResult<image::DynamicImage> {
    let raw = decoder.raw_image(src, params, false).map_err(map_err)?;
    check_size(raw.width as u64, raw.height as u64)?;
    RawDevelop::default()
        .develop_intermediate(&raw)
        .map_err(map_err)?
        .to_dynamic_image()
        .ok_or_else(|| AppError::corrupt("RAW development produced no image"))
}
