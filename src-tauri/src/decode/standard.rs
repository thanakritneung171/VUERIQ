//! JPEG, PNG/APNG, WebP, GIF, BMP, ICO, TIFF, TGA, QOI, PNM, HDR, EXR via image-rs.

use super::{apply_orientation, check_size, fit_within, orientation_to_exif, DecodeMeta, Decoded, Probe, Target};
use crate::color;
use crate::error::{AppError, AppResult};
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

fn open_reader(path: &Path) -> AppResult<ImageReader<BufReader<File>>> {
    let mut r = ImageReader::open(path)?.with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(super::max_pixels() * 8);
    r.limits(limits);
    Ok(r)
}

fn format_name(f: Option<ImageFormat>) -> &'static str {
    match f {
        Some(ImageFormat::Jpeg) => "JPEG",
        Some(ImageFormat::Png) => "PNG",
        Some(ImageFormat::WebP) => "WebP",
        Some(ImageFormat::Gif) => "GIF",
        Some(ImageFormat::Bmp) => "BMP",
        Some(ImageFormat::Ico) => "ICO",
        Some(ImageFormat::Tiff) => "TIFF",
        Some(ImageFormat::Tga) => "TGA",
        Some(ImageFormat::Qoi) => "QOI",
        Some(ImageFormat::Pnm) => "PNM",
        Some(ImageFormat::Hdr) => "Radiance HDR",
        Some(ImageFormat::OpenExr) => "OpenEXR",
        _ => "Image",
    }
}

/// Animated GIF / WebP / APNG are rendered by the WebView (which plays them) rather than as tiles.
pub fn probe_animation(path: &Path) -> AppResult<Probe> {
    let reader = open_reader(path)?;
    let fmt = reader.format();
    let open = || -> AppResult<BufReader<File>> { Ok(BufReader::new(File::open(path)?)) };
    let animated = match fmt {
        Some(ImageFormat::Gif) => {
            use image::AnimationDecoder;
            let dec = image::codecs::gif::GifDecoder::new(open()?)?;
            dec.into_frames().take(2).count() > 1
        }
        Some(ImageFormat::WebP) => image::codecs::webp::WebPDecoder::new(open()?)?.has_animation(),
        Some(ImageFormat::Png) => image::codecs::png::PngDecoder::new(open()?)?.is_apng()?,
        _ => false,
    };
    if !animated {
        return Ok(Probe::Native);
    }
    let (w, h) = reader.into_dimensions()?;
    Ok(Probe::Element {
        width: w,
        height: h,
        animated: true,
        format: match fmt {
            Some(ImageFormat::Gif) => "GIF (animated)",
            Some(ImageFormat::WebP) => "WebP (animated)",
            _ => "APNG (animated)",
        },
    })
}

pub fn decode(path: &Path, target: Target) -> AppResult<Decoded> {
    let reader = open_reader(path)?;
    let fmt = reader.format();

    // Fast path for JPEG thumbnails: DCT-domain downscaling (1/2…1/8) is ~10× faster than a full decode.
    if let (Target::Thumb(max), Some(ImageFormat::Jpeg)) = (target, fmt) {
        if let Ok(d) = jpeg_scaled(path, max) {
            return Ok(d);
        }
    }

    let mut dec = reader.into_decoder()?;
    let (w, h) = dec.dimensions();
    check_size(w as u64, h as u64)?;
    let icc = dec.icc_profile().ok().flatten();
    let orientation = dec.orientation().map(orientation_to_exif).unwrap_or(1);
    let ct = dec.color_type();
    let has_alpha = ct.has_alpha();
    let bit_depth = (ct.bits_per_pixel() / ct.channel_count() as u16) as u8;
    let img = DynamicImage::from_decoder(dec)?;
    let rgba = apply_orientation(img.into_rgba8(), orientation);
    let (ow, oh) = rgba.dimensions();
    let mut data = rgba.into_raw();

    let mut meta = DecodeMeta {
        format: format_name(fmt).into(),
        decoder: "image-rs".into(),
        orientation,
        bit_depth,
        has_alpha,
        ..Default::default()
    };
    if bit_depth > 8 {
        meta.notes.push(format!("{bit_depth}-bit source rendered at 8 bits per channel"));
    }
    if let Some(icc) = icc {
        match color::icc_to_srgb(&mut data, &icc) {
            Some(desc) => {
                meta.color_managed = true;
                meta.color_profile = Some(desc);
            }
            None => meta.notes.push("Embedded ICC profile could not be applied".into()),
        }
    }
    Decoded::new(ow, oh, data, meta)
}

fn jpeg_scaled(path: &Path, max: u32) -> AppResult<Decoded> {
    let file = BufReader::new(File::open(path)?);
    let mut d = jpeg_decoder::Decoder::new(file);
    d.read_info().map_err(AppError::corrupt)?;
    let info = d.info().ok_or_else(|| AppError::corrupt("no JPEG header"))?;
    let (sw, sh) = fit_within(info.width as u32, info.height as u32, max);
    let (w, h) = d.scale(sw.min(u16::MAX as u32) as u16, sh.min(u16::MAX as u32) as u16).map_err(AppError::corrupt)?;
    let px = d.decode().map_err(AppError::corrupt)?;
    let info = d.info().unwrap();
    let (w, h) = (w as u32, h as u32);
    let rgba: Vec<u8> = match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => px.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        jpeg_decoder::PixelFormat::L8 => px.iter().flat_map(|&l| [l, l, l, 255]).collect(),
        jpeg_decoder::PixelFormat::L16 => px.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], 255]).collect(),
        jpeg_decoder::PixelFormat::CMYK32 => px
            .chunks_exact(4)
            .flat_map(|p| {
                let k = 255 - p[3] as u16;
                let c = |v: u8| ((255 - v as u16) * k / 255) as u8;
                [c(p[0]), c(p[1]), c(p[2]), 255]
            })
            .collect(),
    };
    let orientation = crate::exif_util::read_orientation(path).unwrap_or(1);
    let img = image::RgbaImage::from_raw(w, h, rgba).ok_or_else(|| AppError::corrupt("bad JPEG buffer"))?;
    let img = apply_orientation(img, orientation);
    let (ow, oh) = img.dimensions();
    let mut data = img.into_raw();
    let mut meta = DecodeMeta { format: "JPEG".into(), decoder: "jpeg-decoder (scaled)".into(), orientation, bit_depth: 8, ..Default::default() };
    if let Some(icc) = d.icc_profile() {
        if let Some(desc) = color::icc_to_srgb(&mut data, &icc) {
            meta.color_managed = true;
            meta.color_profile = Some(desc);
        }
    }
    Decoded::new(ow, oh, data, meta)
}
