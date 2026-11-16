//! Folder listing, duplicate scan and file operations.

use super::blocking;
use crate::error::{AppError, AppResult};
use crate::{duplicates, fileops, fsx, AppState};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use tauri::Emitter;

#[tauri::command]
pub(crate) fn get_launch_files(state: tauri::State<AppState>) -> Vec<String> {
    std::mem::take(&mut *state.launch_files.lock())
}

#[tauri::command]
pub(crate) async fn list_folder(path: String) -> AppResult<fsx::FolderListing> {
    blocking(move || fsx::list_folder(Path::new(&path))).await
}

#[tauri::command]
pub(crate) fn get_places() -> fsx::Places {
    fsx::places()
}

#[tauri::command]
pub(crate) fn resolve_open_target(path: String) -> AppResult<fsx::OpenTarget> {
    fsx::resolve_open_target(Path::new(&path))
}

#[tauri::command]
pub(crate) fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).exists()).collect()
}

pub(crate) fn to_paths(paths: &[String]) -> Vec<PathBuf> {
    paths.iter().map(PathBuf::from).collect()
}

/// Scan a folder for duplicate media. Emits `dup-progress` events while running.
#[tauri::command]
pub(crate) async fn find_duplicates(app: tauri::AppHandle, folder: String, recursive: bool, similar: bool, threshold: u32) -> AppResult<duplicates::DupReport> {
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
pub(crate) fn cancel_duplicates() {
    duplicates::cancel();
}

#[tauri::command]
pub(crate) fn has_recycle_bin(path: String) -> bool {
    fileops::has_recycle_bin(Path::new(&path))
}

#[tauri::command]
pub(crate) async fn delete_files(paths: Vec<String>, allow_permanent: bool) -> AppResult<Vec<fileops::OpResult>> {
    blocking(move || Ok(fileops::delete_files(&to_paths(&paths), allow_permanent))).await
}

#[tauri::command]
pub(crate) async fn restore_files(paths: Vec<String>) -> AppResult<Vec<fileops::OpResult>> {
    blocking(move || Ok(fileops::restore_files(&to_paths(&paths)))).await
}

#[tauri::command]
pub(crate) async fn move_files(paths: Vec<String>, dest: String) -> AppResult<Vec<fileops::OpResult>> {
    blocking(move || Ok(fileops::move_files(&to_paths(&paths), Path::new(&dest)))).await
}

#[derive(serde::Deserialize)]
pub(crate) struct MovePair {
    from: String,
    to: String,
}

/// Move files to exact targets (used to undo a move).
#[tauri::command]
pub(crate) async fn move_exact(moves: Vec<MovePair>) -> AppResult<Vec<fileops::OpResult>> {
    blocking(move || Ok(moves.iter().map(|m| fileops::move_file(Path::new(&m.from), Path::new(&m.to))).collect())).await
}
