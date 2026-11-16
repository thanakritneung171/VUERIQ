//! Tauri commands invoked from the UI (see src/lib/api.ts). Each submodule is a thin layer that
//! moves blocking work off the async runtime and delegates to the domain modules.

mod files;
mod images;
mod system;
mod playback;

use crate::error::{AppError, AppResult};

/// Run blocking work (disk I/O, decoding) on Tauri's blocking pool.
pub(crate) async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_else(|e| Err(AppError::other("Background task failed").with_detail(e)))
}

pub(crate) fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        files::get_launch_files,
        files::list_folder,
        files::get_places,
        files::resolve_open_target,
        files::paths_exist,
        files::find_duplicates,
        files::cancel_duplicates,
        files::has_recycle_bin,
        files::delete_files,
        files::restore_files,
        files::move_files,
        files::move_exact,
        images::open_image,
        images::prefetch_image,
        images::release_image,
        images::get_metadata,
        system::load_state,
        system::save_state,
        system::set_memory_budget,
        system::cache_stats,
        system::clear_thumbnail_cache,
        system::reveal_in_explorer,
        system::app_info,
        system::association_status,
        system::register_associations,
        system::unregister_associations,
        system::open_default_apps_settings,
        playback::video_engine_info,
        playback::video_load,
        playback::video_stop,
        playback::video_command,
        playback::video_set_property,
        playback::video_set_margins,
    ]
}
