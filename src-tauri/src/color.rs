//! Colour management. Decoded pixels are converted to sRGB (the WebView's working space) using the
//! image's embedded ICC profile (qcms) or, for HEIF/AVIF, its CICP/nclx primaries.

use qcms::{DataType, Intent, Profile, Transform};

/// Convert RGBA8 pixels in place from the given ICC profile to sRGB.
/// Returns Some(profile description) on success, None if the profile is unusable (pixels untouched).
pub fn icc_to_srgb(rgba: &mut [u8], icc: &[u8]) -> Option<String> {
    let desc = icc_description(icc).unwrap_or_else(|| "Embedded ICC profile".to_string());
    if is_srgb_description(&desc) {
        return Some(desc);
    }
    let input = Profile::new_from_slice(icc, false)?;
    let mut output = Profile::new_sRGB();
    output.precache_output_transform();
    let xf = Transform::new(&input, &output, DataType::RGBA8, Intent::Perceptual)?;
    // qcms is single-threaded; parallelise over row chunks for large images.
    use rayon::prelude::*;
    const CHUNK: usize = 4 * 64 * 1024;
    rgba.par_chunks_mut(CHUNK).for_each(|c| xf.apply(c));
    Some(desc)
}

fn is_srgb_description(d: &str) -> bool {
    let l = d.to_ascii_lowercase();
    l.starts_with("srgb") && !l.contains("linear")
}

/// Extract the human-readable profile name ('desc' tag, v2 `desc` or v4 `mluc`).
pub fn icc_description(icc: &[u8]) -> Option<String> {
    if icc.len() < 132 {
        return None;
    }
    let be32 = |o: usize| -> Option<u32> { icc.get(o..o + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]])) };
    let count = be32(128)? as usize;
    for i in 0..count.min(256) {
        let base = 132 + i * 12;
        let sig = icc.get(base..base + 4)?;
        if sig != b"desc" {
            continue;
        }
        let off = be32(base + 4)? as usize;
        let len = be32(base + 8)? as usize;
        let tag = icc.get(off..off.checked_add(len)?)?;
        if tag.len() < 12 {
            return None;
        }
        match &tag[0..4] {
            b"desc" => {
                let n = u32::from_be_bytes([tag[8], tag[9], tag[10], tag[11]]) as usize;
                let s = tag.get(12..12 + n.saturating_sub(1))?;
                return Some(String::from_utf8_lossy(s).trim().to_string()).filter(|s| !s.is_empty());
            }
            b"mluc" => {
                let n = u32::from_be_bytes([tag[8], tag[9], tag[10], tag[11]]) as usize;
                if n == 0 || tag.len() < 28 {
                    return None;
                }
                let slen = u32::from_be_bytes([tag[20], tag[21], tag[22], tag[23]]) as usize;
                let soff = u32::from_be_bytes([tag[24], tag[25], tag[26], tag[27]]) as usize;
                let s = tag.get(soff..soff + slen)?;
                let u16s: Vec<u16> = s.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                return Some(String::from_utf16_lossy(&u16s).trim_end_matches('\0').trim().to_string()).filter(|s| !s.is_empty());
            }
            _ => return None,
        }
    }
    None
}

// ───────────── CICP / nclx (HEIF, AVIF without ICC) ─────────────

fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}
fn linear_to_srgb(v: f32) -> f32 {
    let v = v.clamp(0.0, 1.0);
    if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// Primaries → sRGB (D65) linear matrices.
const P3_TO_SRGB: [[f32; 3]; 3] = [
    [1.224_940_2, -0.224_940_2, 0.0],
    [-0.042_056_955, 1.042_056_9, 0.0],
    [-0.019_637_555, -0.078_636_05, 1.098_273_6],
];
const BT2020_TO_SRGB: [[f32; 3]; 3] = [
    [1.660_491, -0.587_641_1, -0.072_849_9],
    [-0.124_550_5, 1.132_899_9, -0.008_349_4],
    [-0.018_150_8, -0.100_578_9, 1.118_729_7],
];

/// Convert from CICP colour primaries to sRGB. Only SDR transfer (sRGB/BT.709-like) is handled
/// exactly; returns a label if a conversion was applied.
pub fn cicp_to_srgb(rgba: &mut [u8], primaries: u16, transfer: u16) -> Option<&'static str> {
    let (m, label) = match primaries {
        12 | 11 => (P3_TO_SRGB, "Display P3 (CICP)"),
        9 => (BT2020_TO_SRGB, "BT.2020 (CICP)"),
        _ => return None,
    };
    // PQ (16) and HLG (18) are HDR; we still map primaries, values are already tone-mapped to 8-bit by libheif.
    let _ = transfer;
    let mut lut_in = [0f32; 256];
    for (i, v) in lut_in.iter_mut().enumerate() {
        *v = srgb_to_linear(i as f32 / 255.0);
    }
    const N: usize = 4096;
    let lut_out: Vec<u8> = (0..N).map(|i| (linear_to_srgb(i as f32 / (N - 1) as f32) * 255.0 + 0.5) as u8).collect();
    use rayon::prelude::*;
    rgba.par_chunks_mut(4 * 4096).for_each(|chunk| {
        for px in chunk.chunks_exact_mut(4) {
            let r = lut_in[px[0] as usize];
            let g = lut_in[px[1] as usize];
            let b = lut_in[px[2] as usize];
            let o = |row: [f32; 3]| -> u8 {
                let v = (row[0] * r + row[1] * g + row[2] * b).clamp(0.0, 1.0);
                lut_out[(v * (N - 1) as f32 + 0.5) as usize]
            };
            px[0] = o(m[0]);
            px[1] = o(m[1]);
            px[2] = o(m[2]);
        }
    });
    Some(label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_roundtrip_is_identity() {
        for i in 0..=255u8 {
            let v = linear_to_srgb(srgb_to_linear(i as f32 / 255.0));
            assert_eq!((v * 255.0).round() as u8, i);
        }
    }

    #[test]
    fn p3_white_and_black_are_preserved() {
        let mut px = vec![255, 255, 255, 255, 0, 0, 0, 255];
        cicp_to_srgb(&mut px, 12, 13).unwrap();
        assert_eq!(&px[..3], &[255, 255, 255]);
        assert_eq!(&px[4..7], &[0, 0, 0]);
    }

    #[test]
    fn p3_red_is_clipped_saturated_in_srgb() {
        let mut px = vec![255, 0, 0, 255];
        cicp_to_srgb(&mut px, 12, 13).unwrap();
        assert_eq!(px[0], 255);
        assert_eq!(px[1], 0);
    }
}
