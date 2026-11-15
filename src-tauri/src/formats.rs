//! Authoritative registry of file types VUERIQ handles, and which engine decodes each.

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    /// image-rs (JPEG, PNG, WebP, GIF, BMP, ICO, TIFF, TGA, QOI, PNM, HDR, EXR)
    Standard,
    /// libheif + libde265 (HEVC) / dav1d (AV1): HEIC, HEIF, AVIF
    Heif,
    /// jxl-oxide
    Jxl,
    /// resvg (thumbnails) / WebView vector rendering (display)
    Svg,
    /// rawler
    Raw,
    /// libmpv
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
}

pub const STANDARD_EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "apng", "webp", "gif", "bmp", "dib", "ico", "cur", "tif", "tiff", "tga", "qoi",
    "pnm", "pbm", "pgm", "ppm", "hdr", "exr",
];
pub const HEIF_EXTS: &[&str] = &["heic", "heif", "hif", "heics", "avif"];
pub const JXL_EXTS: &[&str] = &["jxl"];
pub const SVG_EXTS: &[&str] = &["svg"];
pub const RAW_EXTS: &[&str] = &[
    "cr2", "cr3", "nef", "nrw", "arw", "srf", "sr2", "dng", "orf", "raf", "rw2", "pef", "srw", "erf", "3fr", "iiq", "mrw",
    "kdc", "dcr", "mos",
];
pub const VIDEO_EXTS: &[&str] = &[
    "mp4", "m4v", "mov", "qt", "mkv", "webm", "avi", "wmv", "asf", "mpeg", "mpg", "mpe", "m2v", "3gp", "3g2", "ts", "m2ts",
    "mts", "flv", "ogv", "vob", "f4v", "divx",
];

pub fn ext_of(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

pub fn engine_for_ext(ext: &str) -> Option<Engine> {
    let e = ext.to_ascii_lowercase();
    let e = e.as_str();
    if STANDARD_EXTS.contains(&e) {
        Some(Engine::Standard)
    } else if HEIF_EXTS.contains(&e) {
        Some(Engine::Heif)
    } else if JXL_EXTS.contains(&e) {
        Some(Engine::Jxl)
    } else if SVG_EXTS.contains(&e) {
        Some(Engine::Svg)
    } else if RAW_EXTS.contains(&e) {
        Some(Engine::Raw)
    } else if VIDEO_EXTS.contains(&e) {
        Some(Engine::Video)
    } else {
        None
    }
}

pub fn engine_for(path: &Path) -> Option<Engine> {
    engine_for_ext(&ext_of(path))
}

pub fn kind_for(path: &Path) -> Option<MediaKind> {
    engine_for(path).map(|e| if e == Engine::Video { MediaKind::Video } else { MediaKind::Image })
}

/// Sniff the real container from magic bytes; files are frequently mis-named (e.g. a HEIC saved as .jpg).
pub fn sniff(path: &Path) -> Option<Engine> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let mut b = [0u8; 32];
    let n = f.read(&mut b).ok()?;
    let b = &b[..n];
    if b.len() >= 12 && &b[4..8] == b"ftyp" {
        let brand = &b[8..12];
        const HEIF: &[&[u8; 4]] = &[b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"avif", b"avis", b"mif2"];
        if HEIF.iter().any(|x| &x[..] == brand) {
            return Some(Engine::Heif);
        }
        if brand == b"crx " {
            return Some(Engine::Raw);
        }
        return Some(Engine::Video);
    }
    if b.starts_with(&[0xFF, 0xD8, 0xFF])
        || b.starts_with(b"\x89PNG")
        || b.starts_with(b"GIF8")
        || b.starts_with(b"BM")
        || (b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP")
    {
        return Some(Engine::Standard);
    }
    if b.starts_with(&[0xFF, 0x0A]) || b.starts_with(&[0, 0, 0, 0x0C, b'J', b'X', b'L', b' ']) {
        return Some(Engine::Jxl);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_extensions() {
        assert_eq!(engine_for_ext("HEIC"), Some(Engine::Heif));
        assert_eq!(engine_for_ext("avif"), Some(Engine::Heif));
        assert_eq!(engine_for_ext("jpg"), Some(Engine::Standard));
        assert_eq!(engine_for_ext("cr3"), Some(Engine::Raw));
        assert_eq!(engine_for_ext("mkv"), Some(Engine::Video));
        assert_eq!(engine_for_ext("svg"), Some(Engine::Svg));
        assert_eq!(engine_for_ext("jxl"), Some(Engine::Jxl));
        assert_eq!(engine_for_ext("txt"), None);
    }
}
