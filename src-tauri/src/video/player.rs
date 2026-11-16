//! The embedded player: one mpv instance rendering behind the WebView, plus its event loop.

use super::mpv::*;
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::Serialize;
use std::ffi::{c_char, c_int, CStr};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};


#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoState {
    pub available: bool,
    pub loaded: bool,
    pub path: Option<String>,
    pub paused: bool,
    pub time_pos: f64,
    pub duration: f64,
    pub volume: f64,
    pub mute: bool,
    pub speed: f64,
    pub eof: bool,
    pub width: i64,
    pub height: i64,
    pub fps: f64,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub hwdec: Option<String>,
    pub frame_ready: bool,
    pub seekable: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct EngineInfo {
    pub available: bool,
    pub version: Option<String>,
    pub library: Option<String>,
    pub error: Option<String>,
}

pub struct Player {
    handle: Mutex<Option<Arc<Handle>>>,
    state: Arc<Mutex<VideoState>>,
    hwnd: isize,
}

impl Player {
    pub fn new(hwnd: isize) -> Self {
        Self { handle: Mutex::new(None), state: Arc::new(Mutex::new(VideoState::default())), hwnd }
    }

    pub fn info() -> EngineInfo {
        match api() {
            Ok(a) => {
                let v = unsafe { (a.client_api_version)() };
                // Ask a throwaway handle for mpv-version (cheap, no window).
                let ver = Handle::create(&[("vo", "null".into()), ("ao", "null".into()), ("idle", "yes".into())])
                    .ok()
                    .and_then(|h| h.get_string("mpv-version"));
                EngineInfo {
                    available: true,
                    version: ver.or_else(|| Some(format!("libmpv client API {}.{}", v >> 16, v & 0xffff))),
                    library: dll_candidates().into_iter().find(|p| p.exists()).map(|p| p.display().to_string()),
                    error: None,
                }
            }
            Err(e) => EngineInfo { available: false, version: None, library: None, error: Some(format!("{e}")) },
        }
    }

    fn ensure(&self, app: &AppHandle, hwdec: bool) -> AppResult<Arc<Handle>> {
        let mut g = self.handle.lock();
        if let Some(h) = g.as_ref() {
            let _ = h.set("hwdec", if hwdec { "auto-safe" } else { "no" });
            return Ok(h.clone());
        }
        let opts: Vec<(&str, String)> = vec![
            ("wid", self.hwnd.to_string()),
            ("vo", "gpu-next".into()),
            ("gpu-api", "d3d11".into()),
            ("hwdec", if hwdec { "auto-safe".into() } else { "no".into() }),
            ("keep-open", "yes".into()),
            ("idle", "yes".into()),
            ("force-window", "no".into()),
            ("osc", "no".into()),
            ("osd-level", "0".into()),
            ("input-default-bindings", "no".into()),
            ("input-vo-keyboard", "no".into()),
            ("input-cursor", "no".into()),
            ("cursor-autohide", "no".into()),
            ("background-color", "#000000".into()),
            ("hr-seek", "yes".into()),
            ("hr-seek-framedrop", "no".into()),
            ("audio-display", "no".into()),
            ("sub-auto", "fuzzy".into()),
            ("ytdl", "no".into()),
            ("load-scripts", "no".into()),
            ("config", "no".into()),
            ("terminal", "no".into()),
            ("msg-level", "all=warn".into()),
        ];
        let h = Arc::new(Handle::create(&opts)?);
        for (name, fmt) in [
            ("time-pos", MPV_FORMAT_DOUBLE),
            ("duration", MPV_FORMAT_DOUBLE),
            ("pause", MPV_FORMAT_FLAG),
            ("volume", MPV_FORMAT_DOUBLE),
            ("mute", MPV_FORMAT_FLAG),
            ("speed", MPV_FORMAT_DOUBLE),
            ("eof-reached", MPV_FORMAT_FLAG),
            ("width", MPV_FORMAT_INT64),
            ("height", MPV_FORMAT_INT64),
            ("container-fps", MPV_FORMAT_DOUBLE),
            ("video-codec", MPV_FORMAT_STRING),
            ("audio-codec-name", MPV_FORMAT_STRING),
            ("hwdec-current", MPV_FORMAT_STRING),
            ("seekable", MPV_FORMAT_FLAG),
            ("vo-configured", MPV_FORMAT_FLAG),
        ] {
            h.observe(name, fmt);
        }
        spawn_event_loop(h.clone(), self.state.clone(), app.clone(), self.hwnd);
        *g = Some(h.clone());
        Ok(h)
    }

    pub fn load(&self, app: &AppHandle, path: &Path, volume: f64, hwdec: bool, loop_file: bool) -> AppResult<()> {
        if !path.exists() {
            return Err(std::io::Error::from(std::io::ErrorKind::NotFound).into());
        }
        std::fs::File::open(path)?; // surfaces permission errors early with a friendly message
        let h = self.ensure(app, hwdec)?;
        {
            let mut s = self.state.lock();
            *s = VideoState {
                available: true,
                path: Some(path.to_string_lossy().into()),
                volume,
                speed: 1.0,
                seekable: true,
                ..Default::default()
            };
        }
        h.set("volume", &volume.to_string())?;
        h.set("loop-file", if loop_file { "inf" } else { "no" })?;
        h.set("speed", "1")?;
        h.set("pause", "no")?;
        h.command(&["loadfile", &path.to_string_lossy(), "replace"])?;
        Ok(())
    }

    pub fn stop(&self) {
        if let Some(h) = self.handle.lock().as_ref() {
            let _ = h.command(&["stop"]);
        }
        let mut s = self.state.lock();
        s.loaded = false;
        s.frame_ready = false;
        s.path = None;
    }

    pub fn command(&self, name: &str, args: &[String]) -> AppResult<()> {
        const ALLOWED: &[&str] = &["seek", "cycle", "frame-step", "frame-back-step", "set", "add", "stop"];
        if !ALLOWED.contains(&name) {
            return Err(AppError::other(format!("command '{name}' not allowed")));
        }
        let g = self.handle.lock();
        let h = g.as_ref().ok_or_else(|| AppError::other("No video loaded"))?;
        let mut v: Vec<&str> = vec![name];
        v.extend(args.iter().map(|s| s.as_str()));
        h.command(&v)
    }

    pub fn set_property(&self, name: &str, value: &str) -> AppResult<()> {
        const ALLOWED: &[&str] = &["pause", "volume", "mute", "speed", "loop-file", "hwdec"];
        if !ALLOWED.contains(&name) {
            return Err(AppError::other(format!("property '{name}' not allowed")));
        }
        let g = self.handle.lock();
        let h = g.as_ref().ok_or_else(|| AppError::other("No video loaded"))?;
        h.set(name, value)
    }

    pub fn set_margins(&self, l: f64, t: f64, r: f64, b: f64) -> AppResult<()> {
        let g = self.handle.lock();
        let Some(h) = g.as_ref() else { return Ok(()) };
        let c = |v: f64| format!("{:.5}", v.clamp(0.0, 0.95));
        h.set("video-margin-ratio-left", &c(l))?;
        h.set("video-margin-ratio-top", &c(t))?;
        h.set("video-margin-ratio-right", &c(r))?;
        h.set("video-margin-ratio-bottom", &c(b))?;
        Ok(())
    }

    pub fn shutdown(&self) {
        let h = self.handle.lock().take();
        if let Some(h) = h {
            let _ = h.command(&["quit"]);
            if let Ok(a) = api() {
                unsafe { (a.wakeup)(h.0) };
            }
        }
    }
}

/// mpv draws into a child window it creates inside `wid`; keep it *below* the WebView so the
/// HTML UI stays on top (transparent where the video should show).
#[cfg(windows)]
fn push_video_window_to_bottom(parent: isize) {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetClassNameW, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    unsafe extern "system" fn cb(hwnd: HWND, _: LPARAM) -> BOOL {
        let mut buf = [0u16; 64];
        let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        let name = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        if name == "mpv" {
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        1
    }
    unsafe {
        EnumChildWindows(parent as HWND, Some(cb), 0);
    }
}
#[cfg(not(windows))]
fn push_video_window_to_bottom(_: isize) {}

fn spawn_event_loop(h: Arc<Handle>, state: Arc<Mutex<VideoState>>, app: AppHandle, hwnd: isize) {
    std::thread::Builder::new()
        .name("vq-mpv-events".into())
        .spawn(move || {
            let a = match api() {
                Ok(a) => a,
                Err(_) => return,
            };
            let mut last_emit = Instant::now() - Duration::from_secs(1);
            let mut dirty = false;
            loop {
                let ev = unsafe { &*(a.wait_event)(h.0, 0.1) };
                let mut important = false;
                match ev.event_id {
                    MPV_EVENT_SHUTDOWN => break,
                    MPV_EVENT_START_FILE => {
                        let mut s = state.lock();
                        s.error = None;
                        s.eof = false;
                        s.frame_ready = false;
                        important = true;
                    }
                    MPV_EVENT_FILE_LOADED => {
                        state.lock().loaded = true;
                        push_video_window_to_bottom(hwnd);
                        important = true;
                    }
                    MPV_EVENT_VIDEO_RECONFIG => {
                        push_video_window_to_bottom(hwnd);
                        important = true;
                    }
                    MPV_EVENT_END_FILE => {
                        let ef = unsafe { &*(ev.data as *const MpvEventEndFile) };
                        let mut s = state.lock();
                        if ef.reason == MPV_END_FILE_REASON_ERROR {
                            let raw = err_str(ef.error);
                            s.error = Some(friendly_video_error(&raw));
                            s.loaded = false;
                        } else if ef.reason == MPV_END_FILE_REASON_EOF {
                            s.eof = true;
                        }
                        important = true;
                    }
                    MPV_EVENT_PROPERTY_CHANGE => {
                        let p = unsafe { &*(ev.data as *const MpvEventProperty) };
                        let name = unsafe { CStr::from_ptr(p.name) }.to_string_lossy();
                        let mut s = state.lock();
                        unsafe {
                            match (name.as_ref(), p.format) {
                                (_, MPV_FORMAT_NONE) => match name.as_ref() {
                                    "time-pos" => s.time_pos = 0.0,
                                    "duration" => s.duration = 0.0,
                                    "video-codec" => s.video_codec = None,
                                    "audio-codec-name" => s.audio_codec = None,
                                    _ => {}
                                },
                                (n, MPV_FORMAT_DOUBLE) => {
                                    let v = *(p.data as *const f64);
                                    match n {
                                        "time-pos" => s.time_pos = v,
                                        "duration" => {
                                            s.duration = v;
                                            important = true
                                        }
                                        "volume" => s.volume = v,
                                        "speed" => s.speed = v,
                                        "container-fps" => s.fps = v,
                                        _ => {}
                                    }
                                }
                                (n, MPV_FORMAT_FLAG) => {
                                    let v = *(p.data as *const c_int) != 0;
                                    important = true;
                                    match n {
                                        "pause" => s.paused = v,
                                        "mute" => s.mute = v,
                                        "eof-reached" => s.eof = v,
                                        "seekable" => s.seekable = v,
                                        "vo-configured" => {
                                            s.frame_ready = v;
                                            if v {
                                                push_video_window_to_bottom(hwnd);
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                (n, MPV_FORMAT_INT64) => {
                                    let v = *(p.data as *const i64);
                                    match n {
                                        "width" => s.width = v,
                                        "height" => s.height = v,
                                        _ => {}
                                    }
                                    important = true;
                                }
                                (n, MPV_FORMAT_STRING) => {
                                    let v = CStr::from_ptr(*(p.data as *const *const c_char)).to_string_lossy().into_owned();
                                    match n {
                                        "video-codec" => s.video_codec = Some(v),
                                        "audio-codec-name" => s.audio_codec = Some(v),
                                        "hwdec-current" => s.hwdec = Some(v),
                                        _ => {}
                                    }
                                    important = true;
                                }
                                _ => {}
                            }
                        }
                        dirty = true;
                    }
                    _ => {}
                }
                if important {
                    dirty = true;
                }
                // Throttle routine updates (time-pos) to ~15 Hz; push state changes immediately.
                if dirty && (important || last_emit.elapsed() >= Duration::from_millis(66)) {
                    let snapshot = state.lock().clone();
                    let _ = app.emit("video-state", snapshot);
                    last_emit = Instant::now();
                    dirty = false;
                }
            }
        })
        .expect("spawn mpv event thread");
}

pub(super) fn friendly_video_error(raw: &str) -> String {
    let l = raw.to_ascii_lowercase();
    if l.contains("unrecognized file format") || l.contains("loading failed") {
        "This file isn't a video format VUERIQ can read, or it is damaged.".into()
    } else if l.contains("no video or audio") || l.contains("no audio or video") {
        "No playable video or audio streams were found — the codec may be unsupported.".into()
    } else {
        format!("Playback failed: {raw}")
    }
}
