//! Format verification against real files. Every format VUERIQ advertises is exercised here.
//!
//! Prerequisites (see docs/TESTING.md):
//!   pwsh scripts/fetch-test-media.ps1                 # real HEIC / AVIF / RAW samples
//!   cargo run --release --example gen_test_media       # synthetic images & videos
//!   cargo test --release --test media_formats -- --test-threads=4

use std::path::{Path, PathBuf};
use std::time::Instant;
use vueriq_lib::decode::{self, Target};
use vueriq_lib::error::ErrorKind;

fn media(rel: &str) -> PathBuf {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-media").join(rel);
    assert!(p.exists(), "missing test file {} — run scripts/fetch-test-media.ps1 and the gen_test_media example", p.display());
    p
}

fn files_in(rel: &str) -> Vec<PathBuf> {
    let dir = media(rel);
    let mut v: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
    v.sort();
    assert!(!v.is_empty(), "no files in {}", dir.display());
    v
}

fn px(d: &decode::Decoded, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * d.width + x) * 4) as usize;
    [d.rgba[i], d.rgba[i + 1], d.rgba[i + 2], d.rgba[i + 3]]
}

fn close(a: [u8; 4], b: [u8; 3], tol: i32) -> bool {
    (0..3).all(|i| (a[i] as i32 - b[i] as i32).abs() <= tol)
}

/// Checks the corner markers of the generated test card (TL red, TR green, BL blue, BR white).
fn assert_card_orientation(d: &decode::Decoded, label: &str) {
    let (w, h) = (d.width, d.height);
    let m = 10;
    assert!(close(px(d, m, m), [255, 0, 0], 40), "{label}: top-left should be red, got {:?}", px(d, m, m));
    assert!(close(px(d, w - m, m), [0, 255, 0], 40), "{label}: top-right should be green, got {:?}", px(d, w - m, m));
    assert!(close(px(d, m, h - m), [0, 0, 255], 40), "{label}: bottom-left should be blue, got {:?}", px(d, m, h - m));
    assert!(close(px(d, w - m, h - m), [255, 255, 255], 40), "{label}: bottom-right should be white");
}

// ───────────── HEIC / HEIF (libheif + libde265, no Windows codecs) ─────────────

#[test]
fn heic_decodes_without_windows_extensions() {
    for f in files_in("downloaded/heic") {
        let t = Instant::now();
        let d = decode::decode(&f, Target::Full).unwrap_or_else(|e| panic!("{}: {e}", f.display()));
        assert!(d.width > 0 && d.height > 0);
        assert_eq!(d.rgba.len(), (d.width * d.height * 4) as usize);
        assert!(d.meta.decoder.contains("libde265"), "{}: decoded by {}", f.display(), d.meta.decoder);
        // Not a flat image: real picture content was decoded.
        let first = px(&d, 0, 0);
        let varied = d.rgba.chunks_exact(4).step_by(997).any(|p| (p[0] as i32 - first[0] as i32).abs() > 20);
        assert!(varied, "{}: decoded image is uniform", f.display());
        println!("HEIC ok  {:<40} {}x{}  {} ms  profile={:?}", f.file_name().unwrap().to_string_lossy(), d.width, d.height, t.elapsed().as_millis(), d.meta.color_profile);
    }
}

#[test]
fn heic_thumbnails_use_embedded_or_scaled_image() {
    let f = media("downloaded/heic/libheif-example.heic");
    let d = decode::decode(&f, Target::Thumb(256)).unwrap();
    assert!(d.width.max(d.height) >= 200, "thumb too small: {}x{}", d.width, d.height);
}

#[test]
fn heic_libheif_is_bundled_dll() {
    // decode something first so libde265 is loaded
    decode::decode(&media("downloaded/heic/nokia-C014.heic"), Target::Full).unwrap();
    // The HEIF engine must come from VUERIQ's own DLLs, never from a Windows codec extension.
    let v = decode::libheif_version().expect("libheif must load");
    assert!(v.starts_with("1."), "libheif version {v}");
    let plugins = decode::libheif_plugins();
    assert!(!plugins.is_empty(), "AV1 plugin (heif-dav1d.dll) was not loaded");
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStringExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetModuleHandleW(name: *const u16) -> isize;
            fn GetModuleFileNameW(m: isize, buf: *mut u16, len: u32) -> u32;
        }
        for dll in ["heif.dll", "libde265.dll"] {
            let w: Vec<u16> = dll.encode_utf16().chain([0]).collect();
            let h = unsafe { GetModuleHandleW(w.as_ptr()) };
            assert!(h != 0, "{dll} is not loaded");
            let mut buf = [0u16; 1024];
            let n = unsafe { GetModuleFileNameW(h, buf.as_mut_ptr(), 1024) };
            let path = std::ffi::OsString::from_wide(&buf[..n as usize]).to_string_lossy().to_lowercase();
            println!("{dll} loaded from {path}");
            assert!(!path.contains("windowsapps") && !path.contains("system32"), "{dll} must be VUERIQ's bundled copy, got {path}");
        }
    }
}

// ───────────── AVIF (libheif + dav1d) ─────────────

#[test]
fn avif_decodes_all_bit_depths_and_subsampling() {
    for f in files_in("downloaded/avif").into_iter().filter(|p| p.extension().unwrap() == "avif") {
        let d = decode::decode(&f, Target::Full).unwrap_or_else(|e| panic!("{}: {e}", f.display()));
        assert!(d.meta.decoder.contains("dav1d"), "{}", d.meta.decoder);
        println!("AVIF ok  {:<40} {}x{}  {}-bit", f.file_name().unwrap().to_string_lossy(), d.width, d.height, d.meta.bit_depth);
    }
    let d = decode::decode(&media("generated/images/card-aom.avif"), Target::Full).unwrap();
    assert_eq!((d.width, d.height), (800, 600));
}

#[test]
fn avif_matches_reference_png() {
    // AOM ships fox.png as the source of the fox AVIFs; mean error must be small.
    let a = decode::decode(&media("downloaded/avif/fox.8bpc.yuv420.avif"), Target::Full).unwrap();
    let r = decode::decode(&media("downloaded/avif/reference-fox.png"), Target::Full).unwrap();
    assert_eq!((a.width, a.height), (r.width, r.height));
    let mut sum = 0u64;
    for (x, y) in a.rgba.iter().zip(r.rgba.iter()) {
        sum += (*x as i32 - *y as i32).unsigned_abs() as u64;
    }
    let mae = sum as f64 / a.rgba.len() as f64;
    println!("AVIF vs reference MAE = {mae:.2}");
    assert!(mae < 8.0, "AVIF decode deviates from reference (MAE {mae:.2})");
}

// ───────────── common raster formats ─────────────

#[test]
fn common_formats_decode_with_correct_pixels() {
    for name in ["card.jpg", "card.webp", "card.bmp", "card.tif", "card-16bit.tif", "card-16bit.png", "card.tga", "card.qoi", "orientation-1.jpg"] {
        let d = decode::decode(&media(&format!("generated/images/{name}")), Target::Full).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!((d.width, d.height), (1200, 800), "{name}");
        assert_card_orientation(&d, name);
    }
    for (name, w, h) in [("static.gif", 300, 200), ("icon.ico", 256, 256), ("alpha.png", 1200, 800)] {
        let d = decode::decode(&media(&format!("generated/images/{name}")), Target::Full).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!((d.width, d.height), (w, h), "{name}");
    }
}

#[test]
fn png_alpha_is_preserved() {
    let d = decode::decode(&media("generated/images/alpha.png"), Target::Full).unwrap();
    assert!(d.meta.has_alpha);
    assert!(px(&d, 5, 400)[3] < 10, "left edge should be transparent");
    assert!(px(&d, 1195, 400)[3] > 245, "right edge should be opaque");
}

#[test]
fn sharp_detail_survives_decode() {
    // The 1-px checkerboard must be intact at full resolution (no smoothing / resampling).
    let d = decode::decode(&media("generated/images/card.webp"), Target::Full).unwrap();
    let (x, y) = (600, 800 / 3 + 20);
    let a = px(&d, x, y)[0] as i32;
    let b = px(&d, x + 1, y)[0] as i32;
    assert!((a - b).abs() > 200, "adjacent pixels {a} / {b} should alternate black/white");
}

#[test]
fn animated_gif_is_detected() {
    match decode::probe(&media("generated/images/animated.gif")).unwrap() {
        decode::Probe::Element { animated, width, height, .. } => {
            assert!(animated);
            assert_eq!((width, height), (160, 120));
        }
        _ => panic!("animated GIF should be rendered as element"),
    }
    assert!(matches!(decode::probe(&media("generated/images/static.gif")).unwrap(), decode::Probe::Native));
}

#[test]
fn svg_size_and_raster() {
    assert_eq!(decode::svg_size(&media("generated/images/vector.svg")).unwrap(), (640, 480));
    let d = decode::render_svg(&media("generated/images/vector.svg"), 320).unwrap();
    assert_eq!((d.width, d.height), (320, 240));
}

#[test]
fn jpeg_xl_decodes() {
    for name in ["card.jxl", "card-lossless.jxl"] {
        let d = decode::decode(&media(&format!("generated/images/{name}")), Target::Full).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!((d.width, d.height), (800, 600), "{name}");
        assert_eq!(d.meta.decoder, "jxl-oxide");
    }
}

// ───────────── EXIF orientation ─────────────

#[test]
fn exif_orientation_all_eight() {
    for o in 1..=8 {
        let f = media(&format!("generated/images/orientation-{o}.jpg"));
        let d = decode::decode(&f, Target::Full).unwrap();
        assert_eq!((d.width, d.height), (1200, 800), "orientation {o}: dims");
        assert_eq!(d.meta.orientation, o, "orientation {o} detected");
        assert_card_orientation(&d, &format!("orientation-{o}"));
        // Thumbnail fast path (scaled JPEG decode) must honour orientation too.
        let t = decode::decode(&f, Target::Thumb(240)).unwrap();
        assert!(t.width > t.height, "orientation {o}: thumbnail should be landscape ({}x{})", t.width, t.height);
        assert_card_orientation(&t, &format!("orientation-{o} thumb"));
    }
}

// ───────────── ICC colour management ─────────────

fn expected_p3_to_srgb(v: [f64; 3]) -> [u8; 3] {
    let lin: Vec<f64> = v.iter().map(|c| (c / 255.0).powf(2.2)).collect();
    let m = [[1.2249, -0.2247, 0.0], [-0.0420, 1.0419, 0.0], [-0.0197, -0.0786, 1.0979]];
    let enc = |x: f64| {
        let x = x.clamp(0.0, 1.0);
        let s = if x <= 0.0031308 { 12.92 * x } else { 1.055 * x.powf(1.0 / 2.4) - 0.055 };
        (s * 255.0).round() as u8
    };
    let mut out = [0u8; 3];
    for i in 0..3 {
        out[i] = enc(m[i][0] * lin[0] + m[i][1] * lin[1] + m[i][2] * lin[2]);
    }
    out
}

#[test]
fn icc_profile_is_applied() {
    let expected = expected_p3_to_srgb([200.0, 100.0, 50.0]);
    for name in ["icc-display-p3.jpg", "icc-display-p3.png"] {
        let d = decode::decode(&media(&format!("generated/images/{name}")), Target::Full).unwrap();
        assert!(d.meta.color_managed, "{name}: should be colour managed");
        assert_eq!(d.meta.color_profile.as_deref(), Some("VUERIQ Test Display P3"));
        let p = px(&d, 128, 128);
        println!("{name}: P3(200,100,50) → sRGB {:?} (expected ≈ {:?})", &p[..3], expected);
        assert!(close(p, expected, 6), "{name}: got {:?}, expected ≈ {:?}", p, expected);
        assert!((p[0] as i32 - 200).abs() > 5 || (p[1] as i32 - 100).abs() > 5, "{name}: pixels were not converted");
    }
}

// ───────────── Camera RAW ─────────────

#[test]
fn camera_raw_formats() {
    let mut failures = vec![];
    for f in files_in("downloaded/raw") {
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        let t = Instant::now();
        match decode::decode(&f, Target::Full) {
            Ok(d) => {
                assert!(d.width >= 1000 && d.height >= 600, "{name}: {}x{}", d.width, d.height);
                println!("RAW ok   {:<28} {}x{}  {} ms  {:?}", name, d.width, d.height, t.elapsed().as_millis(), d.meta.notes);
                let th = decode::decode(&f, Target::Thumb(320)).unwrap_or_else(|e| panic!("{name} thumb: {e}"));
                assert!(th.width > 0);
            }
            Err(e) => failures.push(format!("{name}: {e}")),
        }
    }
    assert!(failures.is_empty(), "RAW failures:\n{}", failures.join("\n"));
}

// ───────────── error handling ─────────────

#[test]
fn corrupt_and_bogus_files_fail_gracefully() {
    for (name, kinds) in [
        ("corrupt-truncated.jpg", &[ErrorKind::Corrupt][..]),
        ("corrupt-garbage.png", &[ErrorKind::Corrupt, ErrorKind::UnsupportedFormat][..]),
        ("empty.heic", &[ErrorKind::Corrupt, ErrorKind::UnsupportedFormat][..]),
        ("not-an-image.jpg", &[ErrorKind::Corrupt, ErrorKind::UnsupportedFormat][..]),
    ] {
        let r = decode::decode(&media(&format!("generated/images/{name}")), Target::Full);
        match r {
            Ok(d) if name == "corrupt-truncated.jpg" => {
                // Truncated JPEGs may decode partially (grey-filled) — acceptable, but must not crash.
                assert!(d.width > 0);
            }
            Ok(_) => panic!("{name} should fail"),
            Err(e) => {
                assert!(kinds.contains(&e.kind), "{name}: unexpected kind {:?} ({e})", e.kind);
                assert!(!e.message.is_empty());
            }
        }
    }
    let missing = decode::probe(Path::new("Z:/definitely/missing/file.jpg"));
    assert_eq!(missing.err().unwrap().kind, ErrorKind::NotFound);
}

#[test]
fn unsupported_extension_reports_clearly() {
    let tmp = tempfile::Builder::new().suffix(".xyz").tempfile().unwrap();
    std::fs::write(tmp.path(), b"hello").unwrap();
    let e = decode::decode(tmp.path(), Target::Full).err().unwrap();
    assert_eq!(e.kind, ErrorKind::UnsupportedFormat);
    assert!(e.message.contains(".xyz"));
}
