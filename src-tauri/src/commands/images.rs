//! Full-resolution image decoding and metadata.

use super::blocking;
use crate::error::AppResult;
use crate::imagestore::ImageInfo;
use crate::{exif_util, AppState};
use std::path::Path;

#[tauri::command]
pub(crate) async fn open_image(path: String, state: tauri::State<'_, AppState>) -> AppResult<ImageInfo> {
    let store = state.store.clone();
    blocking(move || store.open(Path::new(&path), true)).await
}

#[tauri::command]
pub(crate) async fn prefetch_image(path: String, state: tauri::State<'_, AppState>) -> AppResult<()> {
    let store = state.store.clone();
    // Fire and forget at low priority on the thumbnail pool.
    state.thumbs.spawn(move || {
        let _ = store.open(Path::new(&path), false);
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn release_image(id: u64, state: tauri::State<AppState>) {
    if id != 0 {
        state.store.release(id);
    }
}

#[tauri::command]
pub(crate) async fn get_metadata(path: String) -> AppResult<exif_util::Metadata> {
    blocking(move || exif_util::metadata(Path::new(&path))).await
}
