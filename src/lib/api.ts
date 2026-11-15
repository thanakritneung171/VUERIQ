import { invoke } from "@tauri-apps/api/core";
import type {
  ApiError,
  AppInfo,
  AssociationStatus,
  CacheStats,
  FolderListing,
  ImageInfo,
  Metadata,
  PersistedState,
  Places,
  VideoEngineInfo,
} from "./types";

/** Base URL of the `vq` custom protocol (Windows/WebView2 form). */
export const PROTOCOL_BASE = "http://vq.localhost";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function toApiError(e: unknown): ApiError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) return e as ApiError;
  if (typeof e === "string") return { kind: "other", message: e };
  if (e instanceof Error) return { kind: "other", message: e.message };
  return { kind: "other", message: "An unexpected error occurred." };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toApiError(e);
  }
}

export const api = {
  launchFiles: () => call<string[]>("get_launch_files"),
  listFolder: (path: string) => call<FolderListing>("list_folder", { path }),
  places: () => call<Places>("get_places"),
  resolveOpenTarget: (path: string) =>
    call<{ folder: string; file: string | null }>("resolve_open_target", { path }),
  openImage: (path: string) => call<ImageInfo>("open_image", { path }),
  prefetchImage: (path: string) => call<void>("prefetch_image", { path }),
  releaseImage: (id: number) => call<void>("release_image", { id }),
  metadata: (path: string) => call<Metadata>("get_metadata", { path }),
  loadState: () => call<PersistedState | null>("load_state"),
  saveState: (state: PersistedState) => call<void>("save_state", { data: state }),
  setMemoryBudget: (mb: number) => call<void>("set_memory_budget", { mb }),
  cacheStats: () => call<CacheStats>("cache_stats"),
  clearThumbnailCache: () => call<number>("clear_thumbnail_cache"),
  revealInExplorer: (path: string) => call<void>("reveal_in_explorer", { path }),
  appInfo: () => call<AppInfo>("app_info"),
  pathExists: (paths: string[]) => call<boolean[]>("paths_exist", { paths }),

  associationStatus: () => call<AssociationStatus>("association_status"),
  registerAssociations: () => call<void>("register_associations"),
  unregisterAssociations: () => call<void>("unregister_associations"),
  openDefaultAppsSettings: () => call<void>("open_default_apps_settings"),

  videoInfo: () => call<VideoEngineInfo>("video_engine_info"),
  videoLoad: (path: string, opts: { volume: number; hwdec: boolean; loop: boolean }) =>
    call<void>("video_load", { path, volume: opts.volume, hwdec: opts.hwdec, loopFile: opts.loop }),
  videoStop: () => call<void>("video_stop"),
  videoCommand: (name: string, args: string[] = []) => call<void>("video_command", { name, args }),
  videoSetProperty: (name: string, value: string) => call<void>("video_set_property", { name, value }),
  videoSetMargins: (left: number, top: number, right: number, bottom: number) =>
    call<void>("video_set_margins", { left, top, right, bottom }),
};

export function thumbUrl(path: string, size: number, modified: number): string {
  return `${PROTOCOL_BASE}/thumb/${size}?m=${modified}&p=${encodeURIComponent(path)}`;
}

export function fileUrl(path: string): string {
  return `${PROTOCOL_BASE}/file?p=${encodeURIComponent(path)}`;
}

export function tileUrl(id: number, level: number, tx: number, ty: number): string {
  return `${PROTOCOL_BASE}/tile/${id}/${level}/${tx}/${ty}`;
}
