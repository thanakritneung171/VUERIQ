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
mod protocol;
pub mod thumbs;
pub mod video;

use error::{AppError, AppResult};
use imagestore::{ImageInfo, ImageStore};
use parking_lot::Mutex;
use serde::Serialize;
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
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_else(|e| Err(AppError::other("Background task failed").with_detail(e)))
}

// ───────────────────────── commands ─────────────────────────

#[tauri::command]
fn get_launch_files(state: tauri::State<AppState>) -> Vec<String> {
    std::mem::take(&mut *state.launch_files.lock())
}

#[tauri::command]
async fn list_folder(path: String) -> AppResult<fsx::FolderListing> {
    blocking(move || fsx::list_folder(Path::new(&path))).await
}

#[tauri::command]
fn get_places() -> fsx::Places {
    fsx::places()
}

#[tauri::command]
fn resolve_open_target(path: String) -> AppResult<fsx::OpenTarget> {
    fsx::resolve_open_target(Path::new(&path))
}

#[tauri::command]
fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).exists()).collect()
}

fn to_paths(paths: &[String]) -> Vec<PathBuf> {
    paths.iter().map(PathBuf::from).collect()
}

/// Scan a folder for duplicate media. Emits `dup-progress` events while running.
#[tauri::command]
async fn find_duplicates(app: tauri::AppHandle, folder: String, recursive: bool, similar: bool, threshold: u32) -> AppResult<duplicates::DupReport> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err(AppError::other("This location is not a folder."));
    }
    blocking(move || {
        let last = Mutex::new(std::time::Instant::now() - std::time::Duration::from_secs(1));
        let progress = |p: duplicates::Progress| {
            // Throttle to ~12 events/s, but always send the final one of a phase.
            let mut l = last.lock();
            if p.done == p.total || l.elapsed().as_millis() >= 80 {
                *l = std::time::Instant::now();
                let _ = app.emit("dup-progress", p);
            }
        };
        let opts = duplicates::ScanOptions { recursive, similar, threshold: threshold.min(20) };
        Ok(duplicates::scan(&root, opts, &progress))
    })
    .await
}

#[tauri::command]
fn cancel_duplicates() {
    duplicates::cancel();
}

#[tauri::command]
fn has_recycle_bin(path: String) -> bool {
    fileops::has_recycle_bin(Path::new(&path))
}

#[tauri::command]
async fn delete_files(paths: Vec<String>, allow_permanent: bool) -> AppResult<Vec<fileops::OpResult>> {
    blocking(move || Ok(fileops::delete_files(&to_paths(&paths), allow_permanent))).await
}

#[tauri::command]
async fn restore_files(paths: Vec<String>) -> AppResult<Vec<fileops::OpResult>> {
    blocking(move || Ok(fileops::restore_files(&to_paths(&paths)))).await
}

#[tauri::command]
async fn move_files(paths: Vec<String>, dest: String) -> AppResult<Vec<fileops::OpResult>> {
    blocking(move || Ok(fileops::move_files(&to_paths(&paths), Path::new(&dest)))).await
}

#[derive(serde::Deserialize)]
struct MovePair {
    from: String,
    to: String,
}

/// Move files to exact targets (used to undo a move).
#[tauri::command]
async fn move_exact(moves: Vec<MovePair>) -> AppResult<Vec<fileops::OpResult>> {
    blocking(move || Ok(moves.iter().map(|m| fileops::move_file(Path::new(&m.from), Path::new(&m.to))).collect())).await
}

#[tauri::command]
async fn open_image(path: String, state: tauri::State<'_, AppState>) -> AppResult<ImageInfo> {
    let store = state.store.clone();
    blocking(move || store.open(Path::new(&path), true)).await
}

#[tauri::command]
async fn prefetch_image(path: String, state: tauri::State<'_, AppState>) -> AppResult<()> {
    let store = state.store.clone();
    // Fire and forget at low priority on the thumbnail pool.
    state.thumbs.spawn(move || {
        let _ = store.open(Path::new(&path), false);
    });
    Ok(())
}

#[tauri::command]
fn release_image(id: u64, state: tauri::State<AppState>) {
    if id != 0 {
        state.store.release(id);
    }
}

#[tauri::command]
async fn get_metadata(path: String) -> AppResult<exif_util::Metadata> {
    blocking(move || exif_util::metadata(Path::new(&path))).await
}

#[tauri::command]
fn load_state(state: tauri::State<AppState>) -> Option<serde_json::Value> {
    let p = state.config_dir.join("state.json");
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&s).ok()
}

#[tauri::command]
fn save_state(state: tauri::State<AppState>, data: serde_json::Value) -> AppResult<()> {
    std::fs::create_dir_all(&state.config_dir)?;
    let p = state.config_dir.join("state.json");
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&data).unwrap_or_default())?;
    std::fs::rename(tmp, p)?;
    Ok(())
}

#[tauri::command]
fn set_memory_budget(mb: u64, state: tauri::State<AppState>) {
    state.store.set_budget(mb.clamp(256, 16384) * 1024 * 1024);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheStats {
    thumbnail_bytes: u64,
    thumbnail_files: u64,
    decoded_bytes: u64,
    decoded_images: u64,
    decoded_budget: u64,
}

#[tauri::command]
async fn cache_stats(state: tauri::State<'_, AppState>) -> AppResult<CacheStats> {
    let thumbs = state.thumbs.clone();
    let (db, di, budget) = state.store.stats();
    let (tb, tf) = blocking(move || Ok(thumbs.stats())).await?;
    Ok(CacheStats { thumbnail_bytes: tb, thumbnail_files: tf, decoded_bytes: db as u64, decoded_images: di as u64, decoded_budget: budget })
}

#[tauri::command]
async fn clear_thumbnail_cache(state: tauri::State<'_, AppState>) -> AppResult<u64> {
    let thumbs = state.thumbs.clone();
    blocking(move || Ok(thumbs.clear())).await
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer.exe /select needs the raw argument (paths may contain commas/spaces).
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.replace('/', "\\")))
            .spawn()
            .map_err(|e| AppError::other("Could not open Explorer").with_detail(e))?;
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfoDto {
    name: &'static str,
    version: String,
    tagline: &'static str,
    tauri: &'static str,
    libheif: Option<String>,
    mpv: Option<String>,
    cache_dir: String,
    config_dir: String,
    portable: bool,
}

#[tauri::command]
async fn app_info(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> AppResult<AppInfoDto> {
    let mpv = blocking(|| Ok(video::Player::info().version)).await?;
    Ok(AppInfoDto {
        name: APP_NAME,
        version: app.package_info().version.to_string(),
        tagline: TAGLINE,
        tauri: tauri::VERSION,
        libheif: decode::libheif_version(),
        mpv,
        cache_dir: state.cache_dir.display().to_string(),
        config_dir: state.config_dir.display().to_string(),
        portable: state.portable,
    })
}

#[tauri::command]
fn association_status() -> assoc::AssociationStatus {
    assoc::status()
}

#[tauri::command]
fn register_associations() -> AppResult<()> {
    assoc::register()
}

#[tauri::command]
fn unregister_associations() -> AppResult<()> {
    assoc::unregister()
}

#[tauri::command]
fn open_default_apps_settings() -> AppResult<()> {
    #[cfg(windows)]
    {
        let uri = if assoc::status().registered { "ms-settings:defaultapps?registeredAppUser=VUERIQ" } else { "ms-settings:defaultapps" };
        std::process::Command::new("cmd")
            .args(["/C", "start", "", uri])
            .spawn()
            .map_err(|e| AppError::other("Could not open Windows Settings").with_detail(e))?;
    }
    Ok(())
}

// ── video ──

fn player(app: &tauri::AppHandle) -> AppResult<&video::Player> {
    let state: &AppState = app.state::<AppState>().inner();
    if let Some(p) = state.player.get() {
        return Ok(p);
    }
    let win = app.get_webview_window("main").ok_or_else(|| AppError::other("main window missing"))?;
    #[cfg(windows)]
    let hwnd = win.hwnd().map_err(|e| AppError::other("window handle").with_detail(e))?.0 as isize;
    #[cfg(not(windows))]
    let hwnd = {
        let _ = win;
        0isize
    };
    let _ = state.player.set(video::Player::new(hwnd));
    Ok(state.player.get().expect("player initialised"))
}

#[tauri::command]
async fn video_engine_info() -> AppResult<video::EngineInfo> {
    blocking(|| Ok(video::Player::info())).await
}

#[tauri::command]
async fn video_load(app: tauri::AppHandle, path: String, volume: f64, hwdec: bool, loop_file: bool) -> AppResult<()> {
    let a = app.clone();
    blocking(move || player(&a)?.load(&a, Path::new(&path), volume, hwdec, loop_file)).await
}

#[tauri::command]
fn video_stop(app: tauri::AppHandle) {
    if let Some(p) = app.state::<AppState>().player.get() {
        p.stop();
    }
}

#[tauri::command]
fn video_command(app: tauri::AppHandle, name: String, args: Vec<String>) -> AppResult<()> {
    player(&app)?.command(&name, &args)
}

#[tauri::command]
fn video_set_property(app: tauri::AppHandle, name: String, value: String) -> AppResult<()> {
    player(&app)?.set_property(&name, &value)
}

#[tauri::command]
fn video_set_margins(app: tauri::AppHandle, left: f64, top: f64, right: f64, bottom: f64) -> AppResult<()> {
    match app.state::<AppState>().player.get() {
        Some(p) => p.set_margins(left, top, right, bottom),
        None => Ok(()),
    }
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
            store.set_budget(1536 * 1024 * 1024);
            let thumbs = Arc::new(ThumbCache::new(cache_dir.join("thumbs")));
            let launch = args_to_paths(std::env::args().skip(1), std::env::current_dir().ok().as_deref());
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
        .invoke_handler(tauri::generate_handler![
            get_launch_files,
            list_folder,
            get_places,
            resolve_open_target,
            paths_exist,
            has_recycle_bin,
            find_duplicates,
            cancel_duplicates,
            delete_files,
            restore_files,
            move_files,
            move_exact,
            open_image,
            prefetch_image,
            release_image,
            get_metadata,
            load_state,
            save_state,
            set_memory_budget,
            cache_stats,
            clear_thumbnail_cache,
            reveal_in_explorer,
            app_info,
            association_status,
            register_associations,
            unregister_associations,
            open_default_apps_settings,
            video_engine_info,
            video_load,
            video_stop,
            video_command,
            video_set_property,
            video_set_margins,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VUERIQ");
}
