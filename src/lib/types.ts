// Shared types mirroring the Rust backend (src-tauri/src/*). Keep in sync.

export type MediaKind = "image" | "video";

export interface FileEntry {
  path: string;
  name: string;
  ext: string;
  kind: MediaKind;
  size: number;
  /** Unix epoch milliseconds */
  modified: number;
}

export interface DirEntry {
  path: string;
  name: string;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
  files: FileEntry[];
}

export interface Place {
  id: string;
  label: string;
  path: string;
}

export interface Places {
  home: Place[];
  drives: Place[];
}

export interface LevelInfo {
  width: number;
  height: number;
}

export interface ImageInfo {
  id: number;
  path: string;
  /** Display (orientation-corrected) dimensions */
  width: number;
  height: number;
  tileSize: number;
  tileOverlap: number;
  levels: LevelInfo[];
  /** "tiles" = decoded natively and served as RGBA tiles. "element" = rendered by <img> (animated, SVG). */
  render: "tiles" | "element";
  animated: boolean;
  hasAlpha: boolean;
  format: string;
  decoder: string;
  decodeMs: number;
  colorProfile: string | null;
  colorManaged: boolean;
  orientation: number;
  bitDepth: number;
  notes: string[];
}

export interface MetaItem {
  label: string;
  value: string;
}

export interface MetaGroup {
  title: string;
  items: MetaItem[];
}

export interface Metadata {
  groups: MetaGroup[];
}

export interface VideoState {
  available: boolean;
  loaded: boolean;
  path: string | null;
  paused: boolean;
  timePos: number;
  duration: number;
  volume: number;
  mute: boolean;
  speed: number;
  eof: boolean;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hwdec: string | null;
  frameReady: boolean;
  seekable: boolean;
  error: string | null;
}

export interface VideoEngineInfo {
  available: boolean;
  version: string | null;
  library: string | null;
  error: string | null;
}

export interface AssociationStatus {
  registered: boolean;
  exePath: string;
  portable: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  tagline: string;
  tauri: string;
  libheif: string | null;
  mpv: string | null;
  cacheDir: string;
  configDir: string;
  portable: boolean;
}

export interface CacheStats {
  thumbnailBytes: number;
  thumbnailFiles: number;
  decodedBytes: number;
  decodedImages: number;
  decodedBudget: number;
}

export type Theme = "dark" | "light" | "system";
export type ViewerBackground = "default" | "black" | "gray" | "white" | "checker" | "custom";
export type SortKey = "name" | "date" | "size" | "type";
export type ViewMode = "grid" | "list";
export type KindFilter = "all" | "image" | "video";

export interface Settings {
  theme: Theme;
  viewerBackground: ViewerBackground;
  customBackground: string;
  enlargeSmallImages: boolean;
  pixelatedZoom: boolean;
  smoothTransitions: boolean;
  loopNavigation: boolean;
  showInfoPanel: boolean;
  thumbnailSize: number;
  sortKey: SortKey;
  sortDesc: boolean;
  viewMode: ViewMode;
  kindFilter: KindFilter;
  memoryBudgetMb: number;
  videoVolume: number;
  videoHwdec: boolean;
  videoLoop: boolean;
  confirmBeforeLeavingVideo: boolean;
}

export interface PersistedState {
  settings: Settings;
  recent: string[];
  favorites: string[];
  lastFolder: string | null;
}

export interface ApiError {
  kind:
    | "not_found"
    | "permission_denied"
    | "unsupported_format"
    | "unsupported_codec"
    | "corrupt"
    | "out_of_memory"
    | "io"
    | "engine_unavailable"
    | "other";
  message: string;
  detail?: string;
}
