//! Duplicate finder against real photos: exact copies, re-encoded / resized copies,
//! HEIC → JPEG conversions, AVIF vs PNG, videos, and photos that must NOT match.

use std::fs;
use std::path::{Path, PathBuf};
use vueriq_lib::decode::{self, Target};
use vueriq_lib::duplicates::{self, ScanOptions};

fn media(rel: &str) -> PathBuf {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-media").join(rel);
    assert!(p.exists(), "missing test file {} — run scripts/fetch-test-media.ps1 and the gen_test_media example", p.display());
    p
}

fn save_decoded(src: &Path, dst: &Path, scale: f32) {
    let d = decode::decode(src, Target::Full).unwrap();
    let (w, h) = (((d.width as f32) * scale) as u32, ((d.height as f32) * scale) as u32);
    let px = if scale == 1.0 { d.rgba } else { decode::resize_rgba(&d.rgba, d.width, d.height, w, h, false) };
    let img = image::RgbaImage::from_raw(w, h, px).unwrap();
    image::DynamicImage::ImageRgba8(img).to_rgb8().save(dst).unwrap();
}

fn names(g: &duplicates::DupGroup) -> Vec<String> {
    let mut v: Vec<String> = g.files.iter().map(|f| f.name.clone()).collect();
    v.sort();
    v
}

fn build_library() -> tempfile::TempDir {
    let dir = tempfile::Builder::new().prefix("vueriq-dups-").tempdir().unwrap();
    let d = dir.path();
    fs::create_dir(d.join("sub")).unwrap();
    // exact copies (one in a sub-folder)
    fs::copy(media("downloaded/heic/nokia-C003-grid.heic"), d.join("street.heic")).unwrap();
    fs::copy(media("downloaded/heic/nokia-C003-grid.heic"), d.join("street copy.heic")).unwrap();
    fs::copy(media("downloaded/heic/nokia-C003-grid.heic"), d.join("sub").join("street (1).heic")).unwrap();
    // same photo: HEIC original + JPEG conversion
    fs::copy(media("downloaded/heic/libheif-example.heic"), d.join("town.heic")).unwrap();
    save_decoded(&media("downloaded/heic/libheif-example.heic"), &d.join("town-converted.jpg"), 1.0);
    // same photo: reference PNG, AVIF encodings, a half-size JPEG
    fs::copy(media("downloaded/avif/reference-fox.png"), d.join("fox.png")).unwrap();
    fs::copy(media("downloaded/avif/fox.8bpc.yuv420.avif"), d.join("fox.avif")).unwrap();
    save_decoded(&media("downloaded/avif/reference-fox.png"), &d.join("fox-small.jpg"), 0.5);
    // unrelated photos
    fs::copy(media("downloaded/avif/hato.10bpc.avif"), d.join("pigeon.avif")).unwrap();
    fs::copy(media("downloaded/raw/iphone12pro.DNG"), d.join("iphone.dng")).unwrap();
    // two different flat images must not be called similar
    image::RgbImage::from_pixel(64, 48, image::Rgb([200, 30, 30])).save(d.join("flat-red.png")).unwrap();
    image::RgbImage::from_pixel(64, 48, image::Rgb([30, 30, 200])).save(d.join("flat-blue.png")).unwrap();
    // video exact copy
    fs::copy(media("generated/videos/h264.mp4"), d.join("clip.mp4")).unwrap();
    fs::copy(media("generated/videos/h264.mp4"), d.join("clip (2).mp4")).unwrap();
    fs::copy(media("generated/videos/hevc.mkv"), d.join("other.mkv")).unwrap();
    dir
}

#[test]
fn finds_exact_and_similar_groups() {
    let lib = build_library();
    let r = duplicates::scan(lib.path(), ScanOptions { recursive: true, similar: true, threshold: 8 }, &|_| {});
    assert!(!r.cancelled);
    assert_eq!(r.scanned, 15);
    for g in &r.groups {
        println!("{} {:?} reclaim {}", g.kind, names(g), g.reclaimable);
    }
    let find = |n: &str| r.groups.iter().find(|g| g.files.iter().any(|f| f.name == n));

    let street = find("street.heic").expect("street group");
    assert_eq!(street.kind, "exact");
    assert_eq!(names(street), ["street (1).heic", "street copy.heic", "street.heic"]);
    assert_eq!(street.reclaimable, 2 * street.files[0].size);

    let town = find("town.heic").expect("HEIC + JPEG conversion grouped");
    assert_eq!(town.kind, "similar");
    assert_eq!(names(town), ["town-converted.jpg", "town.heic"]);

    let fox = find("fox.png").expect("fox group");
    assert_eq!(fox.kind, "similar");
    assert_eq!(names(fox), ["fox-small.jpg", "fox.avif", "fox.png"]);
    assert_eq!(fox.files[0].name, "fox.png", "largest file first");

    let clip = find("clip.mp4").expect("video copies");
    assert_eq!(clip.kind, "exact");
    assert_eq!(names(clip), ["clip (2).mp4", "clip.mp4"]);

    for lone in ["pigeon.avif", "iphone.dng", "flat-red.png", "flat-blue.png", "other.mkv"] {
        assert!(find(lone).is_none(), "{lone} must not be reported as a duplicate");
    }
    assert_eq!(r.groups.len(), 4);
}

#[test]
fn exact_only_and_non_recursive() {
    let lib = build_library();
    let r = duplicates::scan(lib.path(), ScanOptions { recursive: false, similar: false, threshold: 8 }, &|_| {});
    assert_eq!(r.scanned, 14);
    let mut kinds: Vec<_> = r.groups.iter().map(|g| (g.kind, names(g))).collect();
    kinds.sort();
    assert_eq!(
        kinds,
        vec![
            ("exact", vec!["clip (2).mp4".to_string(), "clip.mp4".to_string()]),
            ("exact", vec!["street copy.heic".to_string(), "street.heic".to_string()]),
        ]
    );
}

#[test]
fn visual_hash_is_stable_across_formats() {
    let png = duplicates::visual_hash(&media("downloaded/avif/reference-fox.png")).unwrap();
    let avif = duplicates::visual_hash(&media("downloaded/avif/fox.10bpc.yuv420.avif")).unwrap();
    let other = duplicates::visual_hash(&media("downloaded/avif/hato.10bpc.avif")).unwrap();
    let d_same = (png.0 ^ avif.0).count_ones();
    let d_other = (png.0 ^ other.0).count_ones();
    println!("fox png↔avif distance {d_same}, fox↔pigeon {d_other}");
    assert!(d_same <= 4);
    assert!(d_other > 16);
}

#[test]
fn scan_can_be_cancelled() {
    let lib = build_library();
    // Cancel as soon as the first progress report arrives.
    let r = duplicates::scan(lib.path(), ScanOptions { recursive: true, similar: true, threshold: 8 }, &|_| duplicates::cancel());
    assert!(r.cancelled);
    assert!(r.groups.is_empty());
    // The next scan starts fresh.
    let r = duplicates::scan(lib.path(), ScanOptions { recursive: true, similar: false, threshold: 8 }, &|_| {});
    assert!(!r.cancelled);
    assert_eq!(r.groups.len(), 2);
}
