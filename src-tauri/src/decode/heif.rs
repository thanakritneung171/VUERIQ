//! HEIC / HEIF / AVIF via libheif, bundled with libde265 (HEVC) and dav1d (AV1).
//! This is what makes iPhone photos open on a clean Windows install — no Microsoft Store
//! "HEIF Image Extensions" / "HEVC Video Extensions" are used or required.

use super::{check_size, DecodeMeta, Decoded, Target};
use crate::color;
use crate::error::{AppError, AppResult, ErrorKind};
use libheif_rs::{ColorSpace, DecodingOptions, HeifContext, HeifError, ImageHandle, ItemId, LibHeif, RgbChroma};
use std::path::Path;

fn map_err(e: HeifError) -> AppError {
    let msg = e.to_string();
    let lower = msg.to_ascii_lowercase();
    if lower.contains("unsupported codec") || lower.contains("no decoding plugin") || lower.contains("unsupported feature") {
        AppError::new(
            ErrorKind::UnsupportedCodec,
            "This HEIF file uses a compression codec VUERIQ can't decode (supported: HEVC and AV1).",
        )
        .with_detail(msg)
    } else if lower.contains("security limit") {
        AppError::new(ErrorKind::OutOfMemory, "The image exceeds libheif's safety limits for size.").with_detail(msg)
    } else {
        AppError::corrupt(msg)
    }
}

pub fn version() -> Option<String> {
    let lib = LibHeif::new_checked().ok()?;
    let v = lib.version();
    Some(format!("{}.{}.{}", v[0], v[1], v[2]))
}

pub fn decode(path: &Path, target: Target) -> AppResult<Decoded> {
    let path_str = path.to_str().ok_or_else(|| AppError::other("Path is not valid Unicode"))?;
    // Read through Rust so Windows long/Unicode paths and sharing modes behave like every other format.
    let bytes = std::fs::read(path)?;
    let lib = LibHeif::new_checked().map_err(map_err)?;
    let ctx = HeifContext::read_from_bytes(&bytes).map_err(map_err)?;
    let _ = path_str;
    let primary = ctx.primary_image_handle().map_err(map_err)?;

    let is_avif = {
        let l = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        l == "avif" || bytes.get(8..12) == Some(b"avif") || bytes.get(8..12) == Some(b"avis")
    };

    // Thumbnails: use an embedded thumbnail item when it is big enough (iPhone HEICs carry one).
    let mut handle_to_decode: Option<ImageHandle> = None;
    let mut used_thumb = false;
    if let Target::Thumb(max) = target {
        let n = primary.number_of_thumbnails();
        if n > 0 {
            let mut ids: Vec<ItemId> = vec![0; n];
            let got = primary.thumbnail_ids(&mut ids);
            for id in ids.into_iter().take(got) {
                if let Ok(t) = primary.thumbnail(id) {
                    if t.width().max(t.height()) as f32 >= max as f32 * 0.9 {
                        handle_to_decode = Some(t);
                        used_thumb = true;
                        break;
                    }
                }
            }
        }
    }
    let handle = handle_to_decode.as_ref().unwrap_or(&primary);

    check_size(handle.width() as u64, handle.height() as u64)?;
    let has_alpha = handle.has_alpha_channel();
    let bit_depth = handle.luma_bits_per_pixel();

    let mut opts = DecodingOptions::new();
    if let Some(o) = opts.as_mut() {
        o.set_convert_hdr_to_8bit(true);
    }
    let img = lib.decode(handle, ColorSpace::Rgb(RgbChroma::Rgba), opts).map_err(map_err)?;
    let planes = img.planes();
    let plane = planes.interleaved.ok_or_else(|| AppError::corrupt("libheif returned no interleaved plane"))?;
    let (w, h) = (plane.width, plane.height);
    let row = w as usize * 4;
    let mut rgba = Vec::new();
    rgba.try_reserve_exact(row * h as usize).map_err(|_| AppError::too_large(w as u64, h as u64))?;
    if plane.storage_bits_per_pixel != 32 {
        return Err(AppError::corrupt(format!("unexpected pixel layout ({} bpp)", plane.storage_bits_per_pixel)));
    }
    for y in 0..h as usize {
        let s = y * plane.stride;
        rgba.extend_from_slice(&plane.data[s..s + row]);
    }

    let mut meta = DecodeMeta {
        format: if is_avif { "AVIF".into() } else { "HEIF / HEIC".into() },
        decoder: if is_avif { "libheif + dav1d".into() } else { "libheif + libde265".into() },
        orientation: 1,
        bit_depth,
        has_alpha,
        ..Default::default()
    };
    if used_thumb {
        meta.notes.push("Embedded thumbnail".into());
    }
    if bit_depth > 8 {
        meta.notes.push(format!("{bit_depth}-bit source rendered at 8 bits per channel"));
    }

    // Colour: prefer an ICC profile ('prof'/'rICC'), else nclx primaries (Display P3 on iPhones).
    if let Some(icc) = primary.color_profile_raw() {
        if let Some(desc) = color::icc_to_srgb(&mut rgba, &icc.data) {
            meta.color_managed = true;
            meta.color_profile = Some(desc);
        }
    } else if let Some(nclx) = primary.color_profile_nclx() {
        let prim = nclx.color_primaries() as u16;
        let trc = nclx.transfer_characteristics() as u16;
        if let Some(label) = color::cicp_to_srgb(&mut rgba, prim, trc) {
            meta.color_managed = true;
            meta.color_profile = Some(label.into());
        }
        if trc == 16 || trc == 18 {
            meta.notes.push("HDR (PQ/HLG) content shown as SDR".into());
        }
    }
    if ctx.top_level_image_handles().len() > 1 {
        meta.notes.push(format!("Contains {} images; showing the primary image", ctx.top_level_image_handles().len()));
    }

    Decoded::new(w, h, rgba, meta)
}
