//! Persisted state, caches, app info and Windows integration.

use super::blocking;
use crate::error::{AppError, AppResult};
use crate::{assoc, decode, video, AppState, APP_NAME, TAGLINE};
use serde::Serialize;

#[tauri::command]
pub(crate) fn load_state(state: tauri::State<AppState>) -> Option<serde_json::Value> {
    let p = state.config_dir.join("state.json");
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&s).ok()
}

#[tauri::command]
pub(crate) fn save_state(state: tauri::State<AppState>, data: serde_json::Value) -> AppResult<()> {
    std::fs::create_dir_all(&state.config_dir)?;
    let p = state.config_dir.join("state.json");
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&data).unwrap_or_default())?;
    std::fs::rename(tmp, p)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_memory_budget(mb: u64, state: tauri::State<AppState>) {
    state.store.set_budget(mb.clamp(256, 16384) * 1024 * 1024);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CacheStats {
    thumbnail_bytes: u64,
    thumbnail_files: u64,
    decoded_bytes: u64,
    decoded_images: u64,
    decoded_budget: u64,
}

#[tauri::command]
pub(crate) async fn cache_stats(state: tauri::State<'_, AppState>) -> AppResult<CacheStats> {
    let thumbs = state.thumbs.clone();
    let (db, di, budget) = state.store.stats();
    let (tb, tf) = blocking(move || Ok(thumbs.stats())).await?;
    Ok(CacheStats { thumbnail_bytes: tb, thumbnail_files: tf, decoded_bytes: db as u64, decoded_images: di as u64, decoded_budget: budget })
}

#[tauri::command]
pub(crate) async fn clear_thumbnail_cache(state: tauri::State<'_, AppState>) -> AppResult<u64> {
    let thumbs = state.thumbs.clone();
    blocking(move || Ok(thumbs.clear())).await
}

#[tauri::command]
pub(crate) fn reveal_in_explorer(path: String) -> AppResult<()> {
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
pub(crate) struct AppInfoDto {
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
pub(crate) async fn app_info(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> AppResult<AppInfoDto> {
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
pub(crate) fn association_status() -> assoc::AssociationStatus {
    assoc::status()
}

#[tauri::command]
pub(crate) fn register_associations() -> AppResult<()> {
    assoc::register()
}

#[tauri::command]
pub(crate) fn unregister_associations() -> AppResult<()> {
    assoc::unregister()
}

#[tauri::command]
pub(crate) fn open_default_apps_settings() -> AppResult<()> {
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
