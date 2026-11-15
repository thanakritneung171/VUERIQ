//! Video engine: libmpv (bundled, FFmpeg-based — H.264, HEVC, VP8/9, AV1, MPEG-2, VC-1, …),
//! loaded at runtime so the image viewer keeps working even if the DLL is missing.
//!
//! mpv renders into the main window (`wid`) *behind* the transparent WebView. The frontend reports
//! the stage rectangle as `video-margin-ratio-*` so the picture sits exactly inside it, and HTML
//! controls are composited on top.

use crate::error::{AppError, AppResult, ErrorKind};
use libloading::Library;
use parking_lot::Mutex;
use serde::Serialize;
use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// ───────────── minimal libmpv FFI ─────────────

#[allow(non_camel_case_types)]
type mpv_handle = c_void;

const MPV_FORMAT_NONE: c_int = 0;
const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;

const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_START_FILE: c_int = 6;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_EVENT_VIDEO_RECONFIG: c_int = 17;
const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

const MPV_END_FILE_REASON_EOF: c_int = 0;
const MPV_END_FILE_REASON_ERROR: c_int = 4;

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventEndFile {
    reason: c_int,
    error: c_int,
}

struct Api {
    _lib: Library,
    client_api_version: unsafe extern "C" fn() -> u64,
    create: unsafe extern "C" fn() -> *mut mpv_handle,
    initialize: unsafe extern "C" fn(*mut mpv_handle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(*mut mpv_handle),
    set_option_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int,
    command: unsafe extern "C" fn(*mut mpv_handle, *mut *const c_char) -> c_int,
    observe_property: unsafe extern "C" fn(*mut mpv_handle, u64, *const c_char, c_int) -> c_int,
    wait_event: unsafe extern "C" fn(*mut mpv_handle, c_double) -> *mut MpvEvent,
    wakeup: unsafe extern "C" fn(*mut mpv_handle),
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    get_property_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char) -> *mut c_char,
    free: unsafe extern "C" fn(*mut c_void),
}

unsafe impl Send for Api {}
unsafe impl Sync for Api {}

static API: OnceLock<Result<Api, String>> = OnceLock::new();

fn dll_candidates() -> Vec<PathBuf> {
    let mut v = vec![];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join("libmpv-2.dll"));
            v.push(dir.join("lib").join("libmpv-2.dll"));
        }
    }
    v.push(PathBuf::from("libmpv-2.dll"));
    v
}

unsafe fn load_api(lib: Library) -> Result<Api, String> {
    macro_rules! sym {
        ($n:literal) => {
            *lib.get(concat!($n, "\0").as_bytes()).map_err(|e| format!("{}: {e}", $n))?
        };
    }
    let client_api_version = sym!("mpv_client_api_version");
    let create = sym!("mpv_create");
    let initialize = sym!("mpv_initialize");
    let terminate_destroy = sym!("mpv_terminate_destroy");
    let set_option_string = sym!("mpv_set_option_string");
    let set_property_string = sym!("mpv_set_property_string");
    let command = sym!("mpv_command");
    let observe_property = sym!("mpv_observe_property");
    let wait_event = sym!("mpv_wait_event");
    let wakeup = sym!("mpv_wakeup");
    let error_string = sym!("mpv_error_string");
    let get_property_string = sym!("mpv_get_property_string");
    let free = sym!("mpv_free");
    Ok(Api {
        _lib: lib,
        client_api_version,
        create,
        initialize,
        terminate_destroy,
        set_option_string,
        set_property_string,
        command,
        observe_property,
        wait_event,
        wakeup,
        error_string,
        get_property_string,
        free,
    })
}

fn api() -> AppResult<&'static Api> {
    API.get_or_init(|| unsafe {
        let mut last = String::from("libmpv-2.dll not found next to VUERIQ.exe");
        for p in dll_candidates() {
            if !p.exists() && p.components().count() > 1 {
                continue;
            }
            match Library::new(&p) {
                Ok(lib) => match load_api(lib) {
                    Ok(a) => return Ok(a),
                    Err(e) => last = e,
                },
                Err(e) => last = format!("{}: {e}", p.display()),
            }
        }
        Err(last)
    })
    .as_ref()
    .map_err(|e| {
        AppError::new(ErrorKind::EngineUnavailable, "The video engine (libmpv) could not be loaded. Reinstall VUERIQ to restore it.")
            .with_detail(e)
    })
}

fn cstr(s: &str) -> CString {
    CString::new(s.replace('\0', "")).unwrap_or_default()
}

struct Handle(*mut mpv_handle);
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}

impl Handle {
    fn create(opts: &[(&str, String)]) -> AppResult<Self> {
        let a = api()?;
        unsafe {
            let h = (a.create)();
            if h.is_null() {
                return Err(AppError::new(ErrorKind::EngineUnavailable, "libmpv failed to initialise."));
            }
            let me = Handle(h);
            for (k, v) in opts {
                let r = (a.set_option_string)(h, cstr(k).as_ptr(), cstr(v).as_ptr());
                if r < 0 {
                    log::warn!("mpv option {k}={v} failed: {}", err_str(r));
                }
            }
            let r = (a.initialize)(h);
            if r < 0 {
                return Err(AppError::new(ErrorKind::EngineUnavailable, "libmpv failed to start.").with_detail(err_str(r)));
            }
            Ok(me)
        }
    }

    fn command(&self, args: &[&str]) -> AppResult<()> {
        let a = api()?;
        let owned: Vec<CString> = args.iter().map(|s| cstr(s)).collect();
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let r = unsafe { (a.command)(self.0, ptrs.as_mut_ptr()) };
        if r < 0 {
            return Err(AppError::other(format!("Video command failed: {}", err_str(r))));
        }
        Ok(())
    }

    fn set(&self, name: &str, value: &str) -> AppResult<()> {
        let a = api()?;
        let r = unsafe { (a.set_property_string)(self.0, cstr(name).as_ptr(), cstr(value).as_ptr()) };
        if r < 0 {
            return Err(AppError::other(format!("Could not set {name}: {}", err_str(r))));
        }
        Ok(())
    }

    fn get_string(&self, name: &str) -> Option<String> {
        let a = api().ok()?;
        unsafe {
            let p = (a.get_property_string)(self.0, cstr(name).as_ptr());
            if p.is_null() {
                return None;
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            (a.free)(p as *mut c_void);
            Some(s)
        }
    }

    fn observe(&self, name: &str, format: c_int) {
        if let Ok(a) = api() {
            unsafe {
                (a.observe_property)(self.0, 0, cstr(name).as_ptr(), format);
            }
        }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        if let Ok(a) = api() {
            unsafe { (a.terminate_destroy)(self.0) };
        }
    }
}

fn err_str(code: c_int) -> String {
    api()
        .ok()
        .map(|a| unsafe { CStr::from_ptr((a.error_string)(code)).to_string_lossy().into_owned() })
        .unwrap_or_else(|| format!("error {code}"))
}

// ───────────── player ─────────────

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

fn friendly_video_error(raw: &str) -> String {
    let l = raw.to_ascii_lowercase();
    if l.contains("unrecognized file format") || l.contains("loading failed") {
        "This file isn't a video format VUERIQ can read, or it is damaged.".into()
    } else if l.contains("no video or audio") || l.contains("no audio or video") {
        "No playable video or audio streams were found — the codec may be unsupported.".into()
    } else {
        format!("Playback failed: {raw}")
    }
}

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
