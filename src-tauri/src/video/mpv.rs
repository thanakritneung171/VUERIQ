//! Minimal libmpv FFI, loaded at runtime with libloading.

use crate::error::{AppError, AppResult, ErrorKind};
use libloading::Library;
use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::OnceLock;


#[allow(non_camel_case_types)]
pub(super) type mpv_handle = c_void;

pub(super) const MPV_FORMAT_NONE: c_int = 0;
pub(super) const MPV_FORMAT_STRING: c_int = 1;
pub(super) const MPV_FORMAT_FLAG: c_int = 3;
pub(super) const MPV_FORMAT_INT64: c_int = 4;
pub(super) const MPV_FORMAT_DOUBLE: c_int = 5;

pub(super) const MPV_EVENT_SHUTDOWN: c_int = 1;
pub(super) const MPV_EVENT_START_FILE: c_int = 6;
pub(super) const MPV_EVENT_END_FILE: c_int = 7;
pub(super) const MPV_EVENT_FILE_LOADED: c_int = 8;
pub(super) const MPV_EVENT_VIDEO_RECONFIG: c_int = 17;
pub(super) const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
pub(super) const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

pub(super) const MPV_END_FILE_REASON_EOF: c_int = 0;
pub(super) const MPV_END_FILE_REASON_ERROR: c_int = 4;

#[repr(C)]
pub(super) struct MpvEvent {
    pub(super) event_id: c_int,
    pub(super) error: c_int,
    pub(super) reply_userdata: u64,
    pub(super) data: *mut c_void,
}

#[repr(C)]
pub(super) struct MpvEventProperty {
    pub(super) name: *const c_char,
    pub(super) format: c_int,
    pub(super) data: *mut c_void,
}

#[repr(C)]
pub(super) struct MpvEventEndFile {
    pub(super) reason: c_int,
    pub(super) error: c_int,
}

pub(super) struct Api {
    pub(super) _lib: Library,
    pub(super) client_api_version: unsafe extern "C" fn() -> u64,
    pub(super) create: unsafe extern "C" fn() -> *mut mpv_handle,
    pub(super) initialize: unsafe extern "C" fn(*mut mpv_handle) -> c_int,
    pub(super) terminate_destroy: unsafe extern "C" fn(*mut mpv_handle),
    pub(super) set_option_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int,
    pub(super) set_property_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int,
    pub(super) command: unsafe extern "C" fn(*mut mpv_handle, *mut *const c_char) -> c_int,
    pub(super) observe_property: unsafe extern "C" fn(*mut mpv_handle, u64, *const c_char, c_int) -> c_int,
    pub(super) wait_event: unsafe extern "C" fn(*mut mpv_handle, c_double) -> *mut MpvEvent,
    pub(super) wakeup: unsafe extern "C" fn(*mut mpv_handle),
    pub(super) error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    pub(super) get_property_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char) -> *mut c_char,
    pub(super) free: unsafe extern "C" fn(*mut c_void),
}

unsafe impl Send for Api {}
unsafe impl Sync for Api {}

static API: OnceLock<Result<Api, String>> = OnceLock::new();

pub(super) fn dll_candidates() -> Vec<PathBuf> {
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

pub(super) unsafe fn load_api(lib: Library) -> Result<Api, String> {
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

pub(super) fn api() -> AppResult<&'static Api> {
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

pub(super) fn cstr(s: &str) -> CString {
    CString::new(s.replace('\0', "")).unwrap_or_default()
}

pub(super) struct Handle(pub(super) *mut mpv_handle);
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}

impl Handle {
    pub(super) fn create(opts: &[(&str, String)]) -> AppResult<Self> {
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

    pub(super) fn command(&self, args: &[&str]) -> AppResult<()> {
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

    pub(super) fn set(&self, name: &str, value: &str) -> AppResult<()> {
        let a = api()?;
        let r = unsafe { (a.set_property_string)(self.0, cstr(name).as_ptr(), cstr(value).as_ptr()) };
        if r < 0 {
            return Err(AppError::other(format!("Could not set {name}: {}", err_str(r))));
        }
        Ok(())
    }

    pub(super) fn get_string(&self, name: &str) -> Option<String> {
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

    pub(super) fn observe(&self, name: &str, format: c_int) {
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

pub(super) fn err_str(code: c_int) -> String {
    api()
        .ok()
        .map(|a| unsafe { CStr::from_ptr((a.error_string)(code)).to_string_lossy().into_owned() })
        .unwrap_or_else(|| format!("error {code}"))
}
