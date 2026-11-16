//! VUERIQ — Premium Universal Image & Video Viewer. See Every Detail.

pub mod assoc;
pub mod color;
pub mod decode;
pub mod duplicates;
pub mod error;
pub mod exif_util;
pub mod fileops;
pub mod formats;
pub mod fsx;
pub mod imagestore;
mod commands;
mod protocol;
pub mod thumbs;
pub mod video;

use imagestore::ImageStore;
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tauri::{Emitter, Manager};
use thumbs::ThumbCache;

pub const APP_NAME: &str = "VUERIQ";
pub const TAGLINE: &str = "See Every Detail.";

pub struct AppState {
    pub store: Arc<ImageStore>,
    pub thumbs: Arc<ThumbCache>,
    pub player: OnceLock<video::Player>,
    pub launch_files: Mutex<Vec<String>>,
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub portable: bool,
}

/// Portable mode: a `portable` marker file next to the executable keeps all data beside it.
fn data_dirs(app: &tauri::App) -> (PathBuf, PathBuf, bool) {
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        if dir.join("portable").exists() || dir.join("portable.txt").exists() {
            return (dir.join("data").join("config"), dir.join("data").join("cache"), true);
        }
    }
    let cfg = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir().join("VUERIQ"));
    let cache = app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir().join("VUERIQ"));
    (cfg, cache, false)
}

fn args_to_paths(args: impl IntoIterator<Item = String>, cwd: Option<&Path>) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with("--") && !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(&a);
            if p.is_relative() {
                cwd.map(|c| c.join(&p)).unwrap_or(p)
            } else {
                p
            }
        })
        .filter(|p| p.exists())
        // Rebuild from components: drops doubled separators and "." so the path matches folder listings.
        .map(|p| p.components().collect::<PathBuf>().to_string_lossy().into_owned())
        .collect()
}

// ───────────────────────── app ─────────────────────────

fn single_instance<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_single_instance::init(|app, argv, cwd| {
        // Double-clicking another file while VUERIQ runs → open it in the existing window.
        let files = args_to_paths(argv.into_iter().skip(1), Some(Path::new(&cwd)));
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        if !files.is_empty() {
            let _ = app.emit("open-files", files);
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Debug builds can opt out so a dev copy runs beside the installed app.
    let single = !(cfg!(debug_assertions) && std::env::var_os("VUERIQ_MULTI_INSTANCE").is_some());
    let builder = if single { builder.plugin(single_instance()) } else { builder };
    builder
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("vq", |ctx, request, responder| {
            protocol::handle(ctx.app_handle().clone(), request, responder);
        })
        .setup(|app| {
            let (config_dir, cache_dir, portable) = data_dirs(app);
            let _ = std::fs::create_dir_all(&config_dir);
            let _ = std::fs::create_dir_all(&cache_dir);
            let store = Arc::new(ImageStore::new(1536 * 1024 * 1024));
            let thumbs = Arc::new(ThumbCache::new(cache_dir.join("thumbs")));
            let launch = args_to_paths(std::env::args().skip(1), std::env::current_dir().ok().as_deref());
            // Opened from Explorer: start decoding the photo now, while the WebView is still loading.
            if let [first] = launch.as_slice() {
                let p = PathBuf::from(first);
                if formats::kind_for(&p) == Some(formats::MediaKind::Image) {
                    let store = store.clone();
                    std::thread::spawn(move || {
                        let _ = store.open(&p, false);
                    });
                }
            }
            app.manage(AppState {
                store,
                thumbs,
                player: OnceLock::new(),
                launch_files: Mutex::new(launch),
                config_dir,
                cache_dir,
                portable,
            });
            // Safety net: if the UI fails to signal readiness, show the window anyway.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(p) = window.app_handle().state::<AppState>().player.get() {
                    p.shutdown();
                }
            }
        })
        .invoke_handler(commands::handler())
        .run(tauri::generate_context!())
        .expect("error while running VUERIQ");
}
