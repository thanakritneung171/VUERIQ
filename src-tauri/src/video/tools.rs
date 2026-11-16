//! Window-less mpv jobs: video thumbnails, plus test-media encoding and probing.

use super::mpv::*;
use super::player::friendly_video_error;
use crate::error::{AppError, AppResult, ErrorKind};
use std::path::Path;
use std::time::{Duration, Instant};

/// Grab a representative frame as a JPEG thumbnail using a short-lived, window-less mpv instance.
pub fn thumbnail(path: &Path, size: u32, tmpdir: &Path) -> AppResult<Vec<u8>> {
    let _ = std::fs::remove_dir_all(tmpdir);
    std::fs::create_dir_all(tmpdir)?;
    let h = Handle::create(&[
        ("vo", "image".into()),
        ("vo-image-format", "jpg".into()),
        ("vo-image-jpeg-quality", "88".into()),
        ("vo-image-outdir", tmpdir.to_string_lossy().into()),
        ("ao", "null".into()),
        ("aid", "no".into()),
        ("sid", "no".into()),
        ("frames", "1".into()),
        ("start", "15%".into()),
        ("hr-seek", "yes".into()),
        ("hwdec", "no".into()),
        ("vf", format!("scale=w={size}:h={size}:force_original_aspect_ratio=decrease")),
        ("config", "no".into()),
        ("load-scripts", "no".into()),
        ("ytdl", "no".into()),
        ("terminal", "no".into()),
        ("idle", "no".into()),
    ])?;
    h.command(&["loadfile", &path.to_string_lossy()])?;
    let a = api()?;
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut err = None;
    loop {
        if Instant::now() > deadline {
            err = Some("timed out".to_string());
            break;
        }
        let ev = unsafe { &*(a.wait_event)(h.0, 0.25) };
        match ev.event_id {
            MPV_EVENT_SHUTDOWN => break,
            MPV_EVENT_END_FILE => {
                let ef = unsafe { &*(ev.data as *const MpvEventEndFile) };
                if ef.reason == MPV_END_FILE_REASON_ERROR {
                    err = Some(err_str(ef.error));
                }
                break;
            }
            _ => {}
        }
    }
    drop(h);
    let file = std::fs::read_dir(tmpdir)?.flatten().map(|e| e.path()).find(|p| p.extension().map(|e| e == "jpg").unwrap_or(false));
    let res = match file {
        Some(f) => Ok(std::fs::read(f)?),
        None => Err(AppError::new(ErrorKind::UnsupportedCodec, "Could not extract a video frame.").with_detail(err.unwrap_or_default())),
    };
    let _ = std::fs::remove_dir_all(tmpdir);
    res
}

/// Test-support: encode a synthetic clip with libmpv's encoding mode (FFmpeg encoders bundled in
/// libmpv). Used by `examples/gen_test_media.rs` to build the video test collection.
#[doc(hidden)]
pub fn encode_test_clip(out: &Path, format: &str, vcodec: &str, acodec: Option<&str>, w: u32, h: u32, seconds: u32) -> AppResult<()> {
    encode_test_clip_with(out, format, vcodec, acodec, w, h, seconds, &[])
}

#[doc(hidden)]
#[allow(clippy::too_many_arguments)]
pub fn encode_test_clip_with(out: &Path, format: &str, vcodec: &str, acodec: Option<&str>, w: u32, h: u32, seconds: u32, extra: &[(&str, &str)]) -> AppResult<()> {
    let _ = std::fs::remove_file(out);
    let mut opts: Vec<(&str, String)> = vec![
        ("o", out.to_string_lossy().into()),
        ("of", format.into()),
        ("ovc", vcodec.into()),
        ("vo", "null".into()),
        ("config", "no".into()),
        ("terminal", "no".into()),
        ("idle", "no".into()),
        ("load-scripts", "no".into()),
        ("ytdl", "no".into()),
    ];
    match acodec {
        Some(a) => opts.push(("oac", a.into())),
        None => opts.push(("audio", "no".into())),
    }
    for (k, val) in extra {
        opts.push((k, val.to_string()));
    }
    let src = match acodec {
        Some(_) => format!("av://lavfi:testsrc2=size={w}x{h}:rate=30:duration={seconds}[out0];sine=frequency=440:duration={seconds}[out1]"),
        None => format!("av://lavfi:testsrc2=size={w}x{h}:rate=30:duration={seconds}"),
    };
    let h = Handle::create(&opts)?;
    h.command(&["loadfile", &src])?;
    let a = api()?;
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut err = None;
    loop {
        if Instant::now() > deadline {
            err = Some("timed out".to_string());
            break;
        }
        let ev = unsafe { &*(a.wait_event)(h.0, 0.5) };
        match ev.event_id {
            MPV_EVENT_SHUTDOWN => break,
            MPV_EVENT_END_FILE => {
                let ef = unsafe { &*(ev.data as *const MpvEventEndFile) };
                if ef.reason == MPV_END_FILE_REASON_ERROR {
                    err = Some(err_str(ef.error));
                }
                break;
            }
            _ => {}
        }
    }
    drop(h);
    match err {
        Some(e) => Err(AppError::other(format!("encode failed: {e}"))),
        None if out.exists() && std::fs::metadata(out).map(|m| m.len() > 1000).unwrap_or(false) => Ok(()),
        None => Err(AppError::other("encode produced no output")),
    }
}

/// Test-support: open a file headlessly and report what libmpv decoded.
#[doc(hidden)]
pub fn probe_playback(path: &Path) -> AppResult<(String, i64, i64, f64, u64)> {
    let h = Handle::create(&[
        ("vo", "null".into()),
        ("ao", "null".into()),
        ("config", "no".into()),
        ("terminal", "no".into()),
        ("idle", "no".into()),
        ("hwdec", "no".into()),
        ("load-scripts", "no".into()),
        ("ytdl", "no".into()),
    ])?;
    h.command(&["loadfile", &path.to_string_lossy()])?;
    let a = api()?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut frames_seen = false;
    let mut result = None;
    loop {
        if Instant::now() > deadline {
            break;
        }
        let ev = unsafe { &*(a.wait_event)(h.0, 0.2) };
        match ev.event_id {
            MPV_EVENT_PLAYBACK_RESTART | MPV_EVENT_VIDEO_RECONFIG => frames_seen = true,
            MPV_EVENT_END_FILE => {
                let ef = unsafe { &*(ev.data as *const MpvEventEndFile) };
                if ef.reason == MPV_END_FILE_REASON_ERROR {
                    return Err(AppError::new(ErrorKind::UnsupportedCodec, friendly_video_error(&err_str(ef.error))));
                }
                break;
            }
            MPV_EVENT_SHUTDOWN => break,
            _ => {}
        }
        if frames_seen && result.is_none() {
            // Require real, continuous decoding: play until ≥1 s of media time has elapsed.
            let until = Instant::now() + Duration::from_secs(15);
            while Instant::now() < until {
                let pos: f64 = h.get_string("time-pos").and_then(|s| s.parse().ok()).unwrap_or(0.0);
                if pos >= 1.0 {
                    break;
                }
                unsafe { (a.wait_event)(h.0, 0.05) };
            }
            let pos: f64 = h.get_string("time-pos").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            if pos < 1.0 {
                return Err(AppError::other(format!("playback stalled at {pos:.2}s")));
            }
            let codec = h.get_string("video-codec").unwrap_or_default();
            let w = h.get_string("width").and_then(|s| s.parse().ok()).unwrap_or(0);
            let hh = h.get_string("height").and_then(|s| s.parse().ok()).unwrap_or(0);
            let dur = h.get_string("duration").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let decoded = h.get_string("estimated-frame-number").and_then(|s| s.parse().ok()).unwrap_or(0);
            result = Some((codec, w, hh, dur, decoded));
            break;
        }
    }
    result.ok_or_else(|| AppError::other("no frames decoded"))
}
