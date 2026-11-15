//! EXIF reading for orientation and the information panel.

use crate::error::AppResult;
use crate::formats::{self, Engine};
use exif::{In, Reader, Tag, Value};
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct MetaItem {
    pub label: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct MetaGroup {
    pub title: String,
    pub items: Vec<MetaItem>,
}

#[derive(Serialize)]
pub struct Metadata {
    pub groups: Vec<MetaGroup>,
}

fn read_exif(path: &Path) -> Option<exif::Exif> {
    let f = File::open(path).ok()?;
    Reader::new().read_from_container(&mut BufReader::new(f)).ok()
}

pub fn read_orientation(path: &Path) -> Option<u32> {
    let ex = read_exif(path)?;
    ex.get_field(Tag::Orientation, In::PRIMARY)?.value.get_uint(0)
}

fn item(label: &str, value: impl Into<String>) -> MetaItem {
    MetaItem { label: label.into(), value: value.into() }
}

fn fmt_time(t: std::time::SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    // Civil-from-days (UTC). The UI shows local time for the gallery; here UTC keeps it unambiguous.
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn human_size(n: u64) -> String {
    const U: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{n} B")
    } else {
        format!("{v:.2} {} ({} bytes)", U[i], n)
    }
}

fn rational(v: &Value) -> Option<f64> {
    match v {
        Value::Rational(r) if !r.is_empty() => Some(r[0].to_f64()),
        Value::SRational(r) if !r.is_empty() => Some(r[0].to_f64()),
        _ => None,
    }
}

fn gps_coord(ex: &exif::Exif, tag: Tag, ref_tag: Tag) -> Option<f64> {
    let f = ex.get_field(tag, In::PRIMARY)?;
    if let Value::Rational(r) = &f.value {
        if r.len() >= 3 {
            let v = r[0].to_f64() + r[1].to_f64() / 60.0 + r[2].to_f64() / 3600.0;
            let neg = ex
                .get_field(ref_tag, In::PRIMARY)
                .map(|f| f.display_value().to_string())
                .map(|s| s.contains('S') || s.contains('W'))
                .unwrap_or(false);
            return Some(if neg { -v } else { v });
        }
    }
    None
}

pub fn metadata(path: &Path) -> AppResult<Metadata> {
    let md = std::fs::metadata(path)?;
    let mut groups = vec![];
    let ext = formats::ext_of(path);

    let mut file = vec![
        item("Folder", path.parent().map(|p| p.display().to_string()).unwrap_or_default()),
        item("Type", format!("{} file", ext.to_ascii_uppercase())),
        item("Size", human_size(md.len())),
    ];
    if let Ok(t) = md.modified() {
        file.push(item("Modified", fmt_time(t)));
    }
    if let Ok(t) = md.created() {
        file.push(item("Created", fmt_time(t)));
    }
    groups.push(MetaGroup { title: "File".into(), items: file });

    let engine = formats::engine_for(path);
    if matches!(engine, Some(Engine::Video) | Some(Engine::Svg)) {
        return Ok(Metadata { groups });
    }

    // Header-only dimension read where cheap.
    let mut image_items = vec![];
    if let Some(Engine::Standard) = engine {
        if let Ok(r) = image::ImageReader::open(path).and_then(|r| r.with_guessed_format()) {
            if let Ok((w, h)) = r.into_dimensions() {
                image_items.push(item("Dimensions", format!("{w} × {h} px ({:.1} MP)", (w as f64 * h as f64) / 1e6)));
            }
        }
    }

    if let Some(ex) = read_exif(path) {
        let get = |t: Tag| ex.get_field(t, In::PRIMARY);
        let disp = |t: Tag| get(t).map(|f| f.display_value().with_unit(&ex).to_string().trim_matches('"').trim().to_string()).filter(|s| !s.is_empty());

        if image_items.is_empty() {
            let w = get(Tag::PixelXDimension).or_else(|| get(Tag::ImageWidth)).and_then(|f| f.value.get_uint(0));
            let h = get(Tag::PixelYDimension).or_else(|| get(Tag::ImageLength)).and_then(|f| f.value.get_uint(0));
            if let (Some(w), Some(h)) = (w, h) {
                image_items.push(item("Dimensions", format!("{w} × {h} px ({:.1} MP)", (w as f64 * h as f64) / 1e6)));
            }
        }
        if let Some(o) = get(Tag::Orientation).and_then(|f| f.value.get_uint(0)) {
            let label = match o {
                1 => "Normal",
                2 => "Mirrored",
                3 => "Rotated 180°",
                4 => "Flipped vertically",
                5 => "Mirrored, rotated 90° CCW",
                6 => "Rotated 90° CW",
                7 => "Mirrored, rotated 90° CW",
                8 => "Rotated 90° CCW",
                _ => "Unknown",
            };
            image_items.push(item("Orientation", label));
        }
        if let Some(v) = disp(Tag::ColorSpace) {
            image_items.push(item("Color space", v));
        }

        let mut cam = vec![];
        let make = disp(Tag::Make).unwrap_or_default();
        let model = disp(Tag::Model).unwrap_or_default();
        let camera = if model.to_lowercase().starts_with(&make.to_lowercase()) { model.clone() } else { format!("{make} {model}") };
        if !camera.trim().is_empty() {
            cam.push(item("Camera", camera.trim()));
        }
        if let Some(v) = disp(Tag::LensModel) {
            cam.push(item("Lens", v));
        }
        if let Some(v) = disp(Tag::DateTimeOriginal).or_else(|| disp(Tag::DateTime)) {
            cam.push(item("Taken", v));
        }
        let mut exposure = vec![];
        if let Some(f) = get(Tag::FNumber).and_then(|f| rational(&f.value)) {
            exposure.push(format!("ƒ/{f:.1}"));
        }
        if let Some(t) = get(Tag::ExposureTime).and_then(|f| rational(&f.value)) {
            exposure.push(if t >= 1.0 { format!("{t:.1}s") } else { format!("1/{:.0}s", 1.0 / t) });
        }
        if let Some(iso) = get(Tag::PhotographicSensitivity).and_then(|f| f.value.get_uint(0)) {
            exposure.push(format!("ISO {iso}"));
        }
        if !exposure.is_empty() {
            cam.push(item("Exposure", exposure.join("  ·  ")));
        }
        if let Some(fl) = get(Tag::FocalLength).and_then(|f| rational(&f.value)) {
            let eq = get(Tag::FocalLengthIn35mmFilm).and_then(|f| f.value.get_uint(0));
            cam.push(item("Focal length", match eq {
                Some(e) if e > 0 => format!("{fl:.1} mm ({e} mm equiv.)"),
                _ => format!("{fl:.1} mm"),
            }));
        }
        if let Some(v) = disp(Tag::ExposureBiasValue) {
            cam.push(item("Exposure bias", v));
        }
        if let Some(v) = disp(Tag::Flash) {
            cam.push(item("Flash", v));
        }
        if let Some(v) = disp(Tag::WhiteBalance) {
            cam.push(item("White balance", v));
        }
        if let Some(v) = disp(Tag::Software) {
            cam.push(item("Software", v));
        }
        if !cam.is_empty() {
            groups.push(MetaGroup { title: "Camera".into(), items: cam });
        }
        if let (Some(lat), Some(lon)) = (
            gps_coord(&ex, Tag::GPSLatitude, Tag::GPSLatitudeRef),
            gps_coord(&ex, Tag::GPSLongitude, Tag::GPSLongitudeRef),
        ) {
            let mut gps = vec![item("Coordinates", format!("{lat:.6}, {lon:.6}"))];
            if let Some(alt) = get(Tag::GPSAltitude).and_then(|f| rational(&f.value)) {
                gps.push(item("Altitude", format!("{alt:.1} m")));
            }
            groups.push(MetaGroup { title: "Location".into(), items: gps });
        }
    } else if let Some(Engine::Raw) = engine {
        // CR3/RAF and others: fall back to rawler's metadata.
        if let Ok(src) = rawler::rawsource::RawSource::new(path) {
            if let Ok(dec) = rawler::get_decoder(&src) {
                if let Ok(md) = dec.raw_metadata(&src, &Default::default()) {
                    let mut cam = vec![item("Camera", format!("{} {}", md.make, md.model))];
                    if let Some(l) = md.lens.as_ref() {
                        cam.push(item("Lens", format!("{} {}", l.lens_make, l.lens_model)));
                    }
                    let e = &md.exif;
                    let mut exposure = vec![];
                    if let Some(f) = e.fnumber {
                        exposure.push(format!("ƒ/{:.1}", f.n as f64 / f.d.max(1) as f64));
                    }
                    if let Some(t) = e.exposure_time {
                        let v = t.n as f64 / t.d.max(1) as f64;
                        exposure.push(if v >= 1.0 { format!("{v:.1}s") } else { format!("1/{:.0}s", 1.0 / v) });
                    }
                    if let Some(iso) = e.iso_speed_ratings {
                        exposure.push(format!("ISO {iso}"));
                    }
                    if !exposure.is_empty() {
                        cam.push(item("Exposure", exposure.join("  ·  ")));
                    }
                    if let Some(d) = &e.date_time_original {
                        cam.push(item("Taken", d.clone()));
                    }
                    groups.push(MetaGroup { title: "Camera".into(), items: cam });
                }
            }
        }
    }

    if !image_items.is_empty() {
        groups.insert(1, MetaGroup { title: "Image".into(), items: image_items });
    }
    Ok(Metadata { groups })
}
