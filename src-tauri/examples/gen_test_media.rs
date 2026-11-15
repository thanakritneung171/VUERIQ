//! Generates the synthetic part of the VUERIQ test media collection into test-media/generated/.
//!   cargo run --release --example gen_test_media
//!
//! Real-world camera / phone samples (HEIC, AVIF, RAW) are downloaded by scripts/fetch-test-media.ps1.

use image::codecs::jpeg::JpegEncoder;
use image::{ImageEncoder, Rgba, RgbaImage};
use std::path::{Path, PathBuf};

fn out_dir() -> PathBuf {
    let d = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-media").join("generated");
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Canonical test card: smooth gradient + fine 1px checker detail + coloured corner markers
/// (TL red, TR green, BL blue, BR white) used to verify orientation handling.
pub fn test_card(w: u32, h: u32) -> RgbaImage {
    let mut img = RgbaImage::from_fn(w, h, |x, y| {
        let r = (x * 255 / w.max(1)) as u8;
        let g = (y * 255 / h.max(1)) as u8;
        let b = 160u8;
        // fine detail band in the middle third: 1-px checkerboard (tests sharp 100% rendering)
        if y > h / 3 && y < h / 3 + h / 12 && x > w / 3 && x < 2 * w / 3 {
            let v = if (x + y) % 2 == 0 { 255 } else { 0 };
            return Rgba([v, v, v, 255]);
        }
        Rgba([r, g, b, 255])
    });
    let m = (w.min(h) / 8).max(4);
    for y in 0..m {
        for x in 0..m {
            img.put_pixel(x, y, Rgba([255, 0, 0, 255]));
            img.put_pixel(w - 1 - x, y, Rgba([0, 255, 0, 255]));
            img.put_pixel(x, h - 1 - y, Rgba([0, 0, 255, 255]));
            img.put_pixel(w - 1 - x, h - 1 - y, Rgba([255, 255, 255, 255]));
        }
    }
    img
}

/// Stored pixels for EXIF orientation `o`, such that displaying them with orientation `o` yields `c`.
fn inverse_orientation(c: &RgbaImage, o: u32) -> RgbaImage {
    use image::imageops::*;
    match o {
        2 => flip_horizontal(c),
        3 => rotate180(c),
        4 => flip_vertical(c),
        5 => rotate270(&flip_horizontal(c)),
        6 => rotate270(c),
        7 => rotate90(&flip_horizontal(c)),
        8 => rotate90(c),
        _ => c.clone(),
    }
}

/// Minimal EXIF APP1 segment containing only the Orientation tag (big-endian TIFF).
fn exif_orientation_segment(o: u16) -> Vec<u8> {
    let mut tiff = vec![b'M', b'M', 0, 42, 0, 0, 0, 8];
    tiff.extend_from_slice(&1u16.to_be_bytes()); // 1 entry
    tiff.extend_from_slice(&0x0112u16.to_be_bytes()); // Orientation
    tiff.extend_from_slice(&3u16.to_be_bytes()); // SHORT
    tiff.extend_from_slice(&1u32.to_be_bytes());
    tiff.extend_from_slice(&o.to_be_bytes());
    tiff.extend_from_slice(&[0, 0]);
    tiff.extend_from_slice(&0u32.to_be_bytes()); // next IFD
    let mut seg = vec![0xFF, 0xE1];
    let len = (2 + 6 + tiff.len()) as u16;
    seg.extend_from_slice(&len.to_be_bytes());
    seg.extend_from_slice(b"Exif\0\0");
    seg.extend_from_slice(&tiff);
    seg
}

fn insert_after_soi(jpeg: &[u8], seg: &[u8]) -> Vec<u8> {
    let mut out = jpeg[..2].to_vec();
    out.extend_from_slice(seg);
    out.extend_from_slice(&jpeg[2..]);
    out
}

fn jpeg_bytes(img: &RgbaImage, q: u8, icc: Option<&[u8]>) -> Vec<u8> {
    let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut buf = vec![];
    let mut enc = JpegEncoder::new_with_quality(&mut buf, q);
    if let Some(icc) = icc {
        enc.set_icc_profile(icc.to_vec()).unwrap();
    }
    enc.write_image(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8).unwrap();
    buf
}

// ───────────── tiny ICC v2 matrix/TRC profile writer (for colour-management tests) ─────────────

fn s15f16(v: f64) -> [u8; 4] {
    ((v * 65536.0).round() as i32).to_be_bytes()
}

/// Display P3 (D65, sRGB-like gamma 2.2 curve) as a v2 ICC profile, PCS D50 via Bradford.
pub fn display_p3_icc() -> Vec<u8> {
    // Bradford-adapted (D50) primaries of Display P3, as published by Apple's Display P3 profile.
    let r = [0.515102, 0.241196, -0.001053];
    let g = [0.291965, 0.692245, 0.041885];
    let b = [0.157153, 0.066561, 0.784073];
    let wtpt = [0.964203, 1.0, 0.824905];
    let xyz = |v: [f64; 3]| -> Vec<u8> {
        let mut t = b"XYZ \0\0\0\0".to_vec();
        for c in v {
            t.extend_from_slice(&s15f16(c));
        }
        t
    };
    let curv = || -> Vec<u8> {
        let mut t = b"curv\0\0\0\0".to_vec();
        t.extend_from_slice(&1u32.to_be_bytes());
        t.extend_from_slice(&((2.2f64 * 256.0) as u16).to_be_bytes()); // u8Fixed8 gamma
        t.extend_from_slice(&[0, 0]);
        t
    };
    let desc = {
        let s = b"VUERIQ Test Display P3\0";
        let mut t = b"desc\0\0\0\0".to_vec();
        t.extend_from_slice(&(s.len() as u32).to_be_bytes());
        t.extend_from_slice(s);
        t.extend_from_slice(&[0u8; 4 + 4 + 2 + 1 + 67]);
        t
    };
    let cprt = b"text\0\0\0\0Public Domain\0".to_vec();
    let tags: Vec<(&[u8; 4], Vec<u8>)> = vec![
        (b"desc", desc),
        (b"cprt", cprt),
        (b"wtpt", xyz(wtpt)),
        (b"rXYZ", xyz(r)),
        (b"gXYZ", xyz(g)),
        (b"bXYZ", xyz(b)),
        (b"rTRC", curv()),
        (b"gTRC", curv()),
        (b"bTRC", curv()),
    ];
    let table_len = 4 + tags.len() * 12;
    let mut offset = 128 + table_len;
    let mut table = (tags.len() as u32).to_be_bytes().to_vec();
    let mut data = vec![];
    for (sig, body) in &tags {
        while (offset + data.len()) % 4 != 0 {
            data.push(0);
        }
        let off = offset + data.len();
        table.extend_from_slice(*sig);
        table.extend_from_slice(&(off as u32).to_be_bytes());
        table.extend_from_slice(&(body.len() as u32).to_be_bytes());
        data.extend_from_slice(body);
    }
    offset = 128 + table.len() + data.len();
    let mut h = vec![0u8; 128];
    h[0..4].copy_from_slice(&(offset as u32).to_be_bytes());
    h[8..12].copy_from_slice(&[2, 0x10, 0, 0]); // v2.1
    h[12..16].copy_from_slice(b"mntr");
    h[16..20].copy_from_slice(b"RGB ");
    h[20..24].copy_from_slice(b"XYZ ");
    h[36..40].copy_from_slice(b"acsp");
    h[68..72].copy_from_slice(&s15f16(0.9642));
    h[72..76].copy_from_slice(&s15f16(1.0));
    h[76..80].copy_from_slice(&s15f16(0.8249));
    let mut out = h;
    out.extend_from_slice(&table);
    out.extend_from_slice(&data);
    out
}

fn save(path: &Path, bytes: &[u8]) {
    std::fs::write(path, bytes).unwrap();
    println!("  wrote {} ({} KB)", path.file_name().unwrap().to_string_lossy(), bytes.len() / 1024);
}

fn main() {
    let dir = out_dir();
    let img_dir = dir.join("images");
    let vid_dir = dir.join("videos");
    std::fs::create_dir_all(&img_dir).unwrap();
    std::fs::create_dir_all(&vid_dir).unwrap();

    println!("Images");
    let card = test_card(1200, 800);

    // JPEG: base, EXIF orientations 1–8, ICC P3, large 96 MP
    save(&img_dir.join("card.jpg"), &jpeg_bytes(&card, 92, None));
    for o in 1..=8u32 {
        let stored = inverse_orientation(&card, o);
        let j = insert_after_soi(&jpeg_bytes(&stored, 95, None), &exif_orientation_segment(o as u16));
        save(&img_dir.join(format!("orientation-{o}.jpg")), &j);
    }
    let p3 = display_p3_icc();
    let swatch = RgbaImage::from_pixel(256, 256, Rgba([200, 100, 50, 255]));
    save(&img_dir.join("icc-display-p3.jpg"), &jpeg_bytes(&swatch, 100, Some(&p3)));
    {
        let mut buf = vec![];
        let mut enc = image::codecs::png::PngEncoder::new(&mut buf);
        enc.set_icc_profile(p3.clone()).unwrap();
        enc.write_image(swatch.as_raw(), 256, 256, image::ExtendedColorType::Rgba8).unwrap();
        save(&img_dir.join("icc-display-p3.png"), &buf);
    }

    // PNG 8-bit RGBA with transparency, 16-bit
    let mut alpha = card.clone();
    for (x, _y, p) in alpha.enumerate_pixels_mut() {
        p.0[3] = (x * 255 / 1200) as u8;
    }
    alpha.save(img_dir.join("alpha.png")).unwrap();
    let card16 = image::DynamicImage::ImageRgba8(card.clone()).to_rgba16();
    card16.save(img_dir.join("card-16bit.png")).unwrap();
    image::DynamicImage::ImageRgba8(card.clone()).to_rgb16().save(img_dir.join("card-16bit.tif")).unwrap();

    // Other raster formats
    card.save(img_dir.join("card.webp")).unwrap(); // lossless WebP
    image::DynamicImage::ImageRgba8(card.clone()).to_rgb8().save(img_dir.join("card.bmp")).unwrap();
    image::DynamicImage::ImageRgba8(card.clone()).to_rgb8().save(img_dir.join("card.tif")).unwrap();
    card.save(img_dir.join("card.tga")).unwrap();
    card.save(img_dir.join("card.qoi")).unwrap();
    image::imageops::resize(&card, 256, 256, image::imageops::FilterType::Lanczos3).save(img_dir.join("icon.ico")).unwrap();
    image::imageops::resize(&card, 300, 200, image::imageops::FilterType::Lanczos3).save(img_dir.join("static.gif")).unwrap();

    // Animated GIF
    {
        use image::codecs::gif::{GifEncoder, Repeat};
        let f = std::fs::File::create(img_dir.join("animated.gif")).unwrap();
        let mut enc = GifEncoder::new(f);
        enc.set_repeat(Repeat::Infinite).unwrap();
        for i in 0..12u32 {
            let frame = RgbaImage::from_fn(160, 120, |x, y| {
                let on = ((x / 20 + y / 20 + i) % 2) == 0;
                if on { Rgba([124, 156, 255, 255]) } else { Rgba([20, 22, 26, 255]) }
            });
            enc.encode_frame(image::Frame::from_parts(frame, 0, 0, image::Delay::from_numer_denom_ms(80, 1))).unwrap();
        }
        println!("  wrote animated.gif");
    }

    // SVG
    save(
        &img_dir.join("vector.svg"),
        br##"<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9c8ff"/><stop offset="1" stop-color="#5b7fff"/></linearGradient></defs>
  <rect width="640" height="480" fill="#111214"/>
  <path d="M170 120 L320 380 L470 120" fill="none" stroke="url(#g)" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="320" cy="170" r="30" fill="#fff"/>
  <text x="320" y="450" font-family="Segoe UI, sans-serif" font-size="28" fill="#a0a4ab" text-anchor="middle">VUERIQ vector test</text>
</svg>"##,
    );

    // Corrupted / truncated files (must produce friendly errors, never crashes)
    let good = jpeg_bytes(&card, 90, None);
    save(&img_dir.join("corrupt-truncated.jpg"), &good[..good.len() / 3]);
    save(&img_dir.join("corrupt-garbage.png"), b"\x89PNG\r\n\x1a\nthis is not really a png at all");
    save(&img_dir.join("empty.heic"), b"");
    save(&img_dir.join("not-an-image.jpg"), b"Hello, I am a text file pretending to be a JPEG.");

    // Large images (performance / memory tests)
    if std::env::args().any(|a| a == "--large") || !img_dir.join("large-96mp.jpg").exists() {
        let big = test_card(12000, 8000);
        save(&img_dir.join("large-96mp.jpg"), &jpeg_bytes(&big, 85, None));
        drop(big);
        let wide = test_card(20000, 2000);
        save(&img_dir.join("panorama-20000x2000.jpg"), &jpeg_bytes(&wide, 85, None));
    }

    println!("Videos (libmpv encoding mode)");
    let clips: &[(&str, &str, &str, Option<&str>)] = &[
        ("h264.mp4", "mp4", "libx264", Some("aac")),
        ("hevc.mp4", "mp4", "libx265", Some("aac")),
        ("h264.mov", "mov", "libx264", Some("aac")),
        ("hevc.mkv", "matroska", "libx265", Some("libopus")),
        ("vp9.webm", "webm", "libvpx-vp9", Some("libopus")),
        ("vp8.webm", "webm", "libvpx", Some("libvorbis")),
        ("av1.mkv", "matroska", "libaom-av1", None),
        ("av1-svt.mp4", "mp4", "libsvtav1", None),
        ("mpeg4.avi", "avi", "mpeg4", Some("libmp3lame")),
        ("wmv2.wmv", "asf", "wmv2", Some("wmav2")),
        ("mpeg2.mpg", "mpeg", "mpeg2video", Some("mp2")),
        ("mpeg2.mpeg", "mpeg", "mpeg2video", Some("mp2")),
        ("h264.m4v", "mp4", "libx264", Some("aac")),
        ("h264.3gp", "3gp", "libx264", Some("aac")),
        ("h264.ts", "mpegts", "libx264", Some("aac")),
        ("h264.mts", "mpegts", "libx264", Some("ac3")),
    ];
    for (name, fmt, vc, ac) in clips {
        let out = vid_dir.join(name);
        if out.exists() {
            println!("  ok    {name}");
            continue;
        }
        match vueriq_lib::video::encode_test_clip(&out, fmt, vc, *ac, 640, 360, 3) {
            Ok(()) => println!("  wrote {name} ({} KB)", std::fs::metadata(&out).map(|m| m.len() / 1024).unwrap_or(0)),
            Err(e) => println!("  FAIL  {name}: {e}"),
        }
    }
    println!("Stills via FFmpeg reference encoders (libjxl, libaom)");
    for (name, fmt, vc, extra) in [
        ("card.jxl", "image2", "libjxl", vec![("frames", "1"), ("ofopts", "update=1"), ("ovcopts", "distance=1.0")]),
        ("card-lossless.jxl", "image2", "libjxl", vec![("frames", "1"), ("ofopts", "update=1"), ("ovcopts", "distance=0")]),
        ("card-aom.avif", "avif", "libaom-av1", vec![("frames", "1"), ("ovcopts", "still-picture=1,crf=20")]),
    ] {
        let out = img_dir.join(name);
        match vueriq_lib::video::encode_test_clip_with(&out, fmt, vc, None, 800, 600, 1, &extra) {
            Ok(()) => println!("  wrote {name} ({} KB)", std::fs::metadata(&out).map(|m| m.len() / 1024).unwrap_or(0)),
            Err(e) => println!("  FAIL  {name}: {e}"),
        }
    }
    save(&vid_dir.join("corrupt.mp4"), b"\x00\x00\x00\x18ftypmp42 definitely not a real movie");
    println!("Done → {}", dir.display());
}
