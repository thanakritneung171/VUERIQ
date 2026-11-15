//! Large-image handling, pyramid/tiles, memory budget, thumbnail cache, video engine, associations.

use std::path::PathBuf;
use std::time::Instant;
use vueriq_lib::imagestore::{ImageStore, TILE_OVERLAP, TILE_SIZE};
use vueriq_lib::thumbs::ThumbCache;

fn media(rel: &str) -> PathBuf {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-media").join(rel);
    assert!(p.exists(), "missing test file {} — see docs/TESTING.md", p.display());
    p
}

const MB: u64 = 1024 * 1024;

#[test]
fn large_image_builds_pyramid_and_serves_tiles() {
    let store = ImageStore::new(2048 * MB);
    store.set_budget(2048 * MB);
    let t = Instant::now();
    let info = store.open(&media("generated/images/large-96mp.jpg"), true).unwrap();
    let ms = t.elapsed().as_millis();
    println!("96 MP open (decode + pyramid): {ms} ms, decode {} ms, levels {:?}", info.decode_ms, info.levels.iter().map(|l| (l.width, l.height)).collect::<Vec<_>>());
    assert_eq!((info.width, info.height), (12000, 8000));
    assert_eq!(info.levels.len(), 5); // 12000 → 6000 → 3000 → 1500 → 750
    let top = info.levels.len() - 1;
    let t0 = store.tile(info.id, top, 0, 0).unwrap();
    assert_eq!(t0.len(), (750 * 500 * 4) as usize);
    // Interior full-res tile includes the overlap border on all sides.
    let tile = store.tile(info.id, 0, 3, 3).unwrap();
    let side = (TILE_SIZE + 2 * TILE_OVERLAP) as usize;
    assert_eq!(tile.len(), side * side * 4);
    // Out-of-range tiles are rejected, not panicking.
    assert!(store.tile(info.id, 0, 99, 0).is_err());
    store.release(info.id);
}

#[test]
fn panorama_tiles_cover_extreme_aspect() {
    let store = ImageStore::new(1024 * MB);
    store.set_budget(1024 * MB);
    let info = store.open(&media("generated/images/panorama-20000x2000.jpg"), true).unwrap();
    assert_eq!((info.width, info.height), (20000, 2000));
    let l0 = info.levels[0];
    let cols = l0.width.div_ceil(TILE_SIZE);
    let last = store.tile(info.id, 0, cols - 1, 0).unwrap();
    assert!(!last.is_empty());
}

#[test]
fn memory_budget_evicts_unpinned_images() {
    // Budget fits ~one 1200×800 image pyramid (≈5 MB).
    let store = ImageStore::new(6 * MB);
    let a = store.open(&media("generated/images/card.jpg"), false).unwrap();
    let _b = store.open(&media("generated/images/card.webp"), false).unwrap();
    let _c = store.open(&media("generated/images/card.bmp"), false).unwrap();
    let (bytes, count, budget) = store.stats();
    println!("after 3 unpinned opens: {count} image(s), {bytes} bytes / budget {budget}");
    assert!(bytes as u64 <= budget, "store exceeds budget");
    assert!(count <= 2);
    // The oldest was evicted, so its tiles are gone (buffers released).
    assert!(store.tile(a.id, 0, 0, 0).is_err());

    // Pinned images are never evicted.
    let store = ImageStore::new(1 * MB);
    let p = store.open(&media("generated/images/card.jpg"), true).unwrap();
    let _q = store.open(&media("generated/images/card.webp"), false).unwrap();
    assert!(store.tile(p.id, 0, 0, 0).is_ok(), "pinned image must survive");
    store.release(p.id);
    let _r = store.open(&media("generated/images/card.tga"), false).unwrap();
    assert!(store.tile(p.id, 0, 0, 0).is_err(), "released image should be evicted under pressure");
}

#[test]
fn reopening_same_file_reuses_decode() {
    let store = ImageStore::new(512 * MB);
    let a = store.open(&media("generated/images/card.jpg"), true).unwrap();
    let t = Instant::now();
    let b = store.open(&media("generated/images/card.jpg"), true).unwrap();
    assert_eq!(a.id, b.id);
    assert!(t.elapsed().as_millis() < 50, "cache hit should be instant");
}

#[test]
fn thumbnail_cache_hits_and_clears() {
    let dir = tempfile::tempdir().unwrap();
    let cache = ThumbCache::new(dir.path().join("thumbs"));
    let f = media("generated/images/large-96mp.jpg");
    let t = Instant::now();
    let a = cache.get(&f, 320).unwrap();
    let cold = t.elapsed();
    let t = Instant::now();
    let b = cache.get(&f, 320).unwrap();
    let warm = t.elapsed();
    println!("thumbnail cold {cold:?}, warm {warm:?}, {} bytes", a.bytes.len());
    assert_eq!(a.bytes, b.bytes);
    assert!(warm < cold);
    let img = image::load_from_memory(&a.bytes).unwrap();
    assert_eq!(img.width().max(img.height()), 320);
    let (bytes, files) = cache.stats();
    assert_eq!(files, 1);
    assert!(bytes > 0);
    // Different size bucket → separate cache entry; alpha → PNG.
    let p = cache.get(&media("generated/images/alpha.png"), 192).unwrap();
    assert_eq!(p.mime, "image/png");
    assert!(cache.clear() > 0);
    assert_eq!(cache.stats().1, 0);
}

#[test]
fn thumbnails_for_every_image_family() {
    let dir = tempfile::tempdir().unwrap();
    let cache = ThumbCache::new(dir.path().to_path_buf());
    for rel in [
        "downloaded/heic/libheif-example.heic",
        "downloaded/avif/fox.8bpc.yuv420.avif",
        "downloaded/raw/canon-600d.CR2",
        "downloaded/raw/sony-a6000.ARW",
        "generated/images/card.jxl",
        "generated/images/vector.svg",
        "generated/images/animated.gif",
        "generated/images/orientation-6.jpg",
    ] {
        let t = cache.get(&media(rel), 192).unwrap_or_else(|e| panic!("{rel}: {e}"));
        let img = image::load_from_memory(&t.bytes).unwrap();
        assert!(img.width().max(img.height()) <= 192 && img.width() > 0, "{rel}");
    }
}

#[test]
fn video_thumbnails() {
    let dir = tempfile::tempdir().unwrap();
    let cache = ThumbCache::new(dir.path().to_path_buf());
    for name in ["h264.mp4", "hevc.mkv", "vp9.webm", "av1.mkv"] {
        let t = cache.get(&media(&format!("generated/videos/{name}")), 192).unwrap_or_else(|e| panic!("{name}: {e}"));
        let img = image::load_from_memory(&t.bytes).unwrap();
        assert_eq!(img.width(), 192, "{name}");
        assert_eq!(img.height(), 108, "{name}");
    }
}

#[test]
fn video_playback_all_containers_and_codecs() {
    // (file, substring of libavcodec's descriptive codec name)
    let expect = [
        ("h264.mp4", "H.264"),
        ("hevc.mp4", "HEVC"),
        ("h264.mov", "H.264"),
        ("hevc.mkv", "HEVC"),
        ("vp9.webm", "VP9"),
        ("vp8.webm", "VP8"),
        ("av1.mkv", "AV1"),
        ("av1-svt.mp4", "AV1"),
        ("mpeg4.avi", "MPEG-4 part 2"),
        ("wmv2.wmv", "Windows Media Video 8"),
        ("mpeg2.mpg", "MPEG-2"),
        ("mpeg2.mpeg", "MPEG-2"),
        ("h264.m4v", "H.264"),
        ("h264.3gp", "H.264"),
        ("h264.ts", "H.264"),
        ("h264.mts", "H.264"),
    ];
    let mut failures = vec![];
    for (name, codec) in expect {
        match vueriq_lib::video::probe_playback(&media(&format!("generated/videos/{name}"))) {
            Ok((c, w, h, dur, frames)) => {
                println!("VIDEO ok {name:<14} codec={c:<28} {w}x{h} dur={dur:.2}s frames={frames}");
                if (w, h) != (640, 360) {
                    failures.push(format!("{name}: size {w}x{h}"));
                }
                if !c.contains(codec) {
                    failures.push(format!("{name}: codec '{c}', expected {codec}"));
                }
                if (dur - 3.0).abs() > 0.5 {
                    failures.push(format!("{name}: duration {dur}"));
                }
            }
            Err(e) => failures.push(format!("{name}: {e}")),
        }
    }
    assert!(failures.is_empty(), "video failures:\n{}", failures.join("\n"));
    assert!(vueriq_lib::video::probe_playback(&media("generated/videos/corrupt.mp4")).is_err());
}

#[cfg(windows)]
#[test]
fn file_associations_register_and_unregister_in_sandbox() {
    use winreg::enums::*;
    use winreg::RegKey;
    let prefix = r"Software\VUERIQ_TestSandbox";
    let exe = r"C:\Program Files\VUERIQ\VUERIQ.exe";
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(prefix);

    vueriq_lib::assoc::register_at(prefix, exe).unwrap();
    assert!(vueriq_lib::assoc::status_at(prefix, exe).registered);
    let cmd: String = hkcu.open_subkey(format!(r"{prefix}\Classes\VUERIQ.Image\shell\open\command")).unwrap().get_value("").unwrap();
    assert_eq!(cmd, format!("\"{exe}\" \"%1\""));
    for ext in ["heic", "heif", "avif", "jpg", "png", "cr3", "dng"] {
        let k = hkcu.open_subkey(format!(r"{prefix}\Classes\.{ext}\OpenWithProgids")).unwrap();
        let _: String = k.get_value("VUERIQ.Image").unwrap_or_else(|_| panic!(".{ext} not registered"));
    }
    for ext in ["mp4", "mkv", "mov", "webm", "mts"] {
        let fa = hkcu.open_subkey(format!(r"{prefix}\VUERIQ\Capabilities\FileAssociations")).unwrap();
        let v: String = fa.get_value(format!(".{ext}")).unwrap();
        assert_eq!(v, "VUERIQ.Video");
    }
    let caps: String = hkcu.open_subkey(format!(r"{prefix}\RegisteredApplications")).unwrap().get_value("VUERIQ").unwrap();
    assert_eq!(caps, format!(r"{prefix}\VUERIQ\Capabilities"));

    vueriq_lib::assoc::unregister_at(prefix).unwrap();
    assert!(!vueriq_lib::assoc::status_at(prefix, exe).registered);
    assert!(hkcu.open_subkey(format!(r"{prefix}\Classes\VUERIQ.Image")).is_err());
    let _ = hkcu.delete_subkey_all(prefix);
}
