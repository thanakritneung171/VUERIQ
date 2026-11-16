//! Embedded libmpv playback.

use super::blocking;
use crate::error::{AppError, AppResult};
use crate::{video, AppState};
use std::path::Path;
use tauri::Manager;

pub(crate) fn player(app: &tauri::AppHandle) -> AppResult<&video::Player> {
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
pub(crate) async fn video_engine_info() -> AppResult<video::EngineInfo> {
    blocking(|| Ok(video::Player::info())).await
}

#[tauri::command]
pub(crate) async fn video_load(app: tauri::AppHandle, path: String, volume: f64, hwdec: bool, loop_file: bool) -> AppResult<()> {
    let a = app.clone();
    blocking(move || player(&a)?.load(&a, Path::new(&path), volume, hwdec, loop_file)).await
}

#[tauri::command]
pub(crate) fn video_stop(app: tauri::AppHandle) {
    if let Some(p) = app.state::<AppState>().player.get() {
        p.stop();
    }
}

#[tauri::command]
pub(crate) fn video_command(app: tauri::AppHandle, name: String, args: Vec<String>) -> AppResult<()> {
    player(&app)?.command(&name, &args)
}

#[tauri::command]
pub(crate) fn video_set_property(app: tauri::AppHandle, name: String, value: String) -> AppResult<()> {
    player(&app)?.set_property(&name, &value)
}

#[tauri::command]
pub(crate) fn video_set_margins(app: tauri::AppHandle, left: f64, top: f64, right: f64, bottom: f64) -> AppResult<()> {
    match app.state::<AppState>().player.get() {
        Some(p) => p.set_margins(left, top, right, bottom),
        None => Ok(()),
    }
}
