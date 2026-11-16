import type {
  ApiError,
  FileEntry,
  FolderListing,
  OpResult,
  Settings,
} from "../lib/types";

export type Section =
  | "home"
  | "recent"
  | "favorites"
  | "browse"
  | "swipe"
  | "duplicates"
  | "settings";

/** An undoable file operation (gallery / viewer). */
export type UndoEntry =
  | { kind: "delete"; paths: string[] }
  | { kind: "move"; moves: { from: string; to: string }[]; dest: string };

export interface ToastState {
  id: number;
  message: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface DeleteOutcome {
  /** Paths that are gone (recycled or permanently deleted). */
  deleted: string[];
  /** Subset of `deleted` that can be restored from the Recycle Bin. */
  recycled: string[];
  failed: OpResult[];
}

export interface ViewerState {
  items: FileEntry[];
  index: number;
}

/** Library, settings and navigation (persisted parts live here). */
export interface CoreSlice {
  ready: boolean;
  section: Section;
  settings: Settings;
  recent: string[];
  favorites: string[];
  lastFolder: string | null;

  folder: FolderListing | null;
  folderLoading: boolean;
  folderError: ApiError | null;
  search: string;

  init: () => Promise<void>;
  setSection: (s: Section) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  openFolder: (path: string) => Promise<void>;
  refreshFolder: () => Promise<void>;
  setSearch: (q: string) => void;
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  clearRecent: () => void;
  toggleFavorite: (path: string) => void;
}

/** The full-screen viewer and its quick (Explorer) mode. */
export interface ViewerSlice {
  viewer: ViewerState | null;
  /** Quick viewer: just the photo / video, no sidebar or gallery (files opened from Explorer). */
  quick: boolean;
  fullscreen: boolean;

  openViewer: (items: FileEntry[], index: number) => void;
  /** Open arbitrary paths (Explorer "Open with", drag & drop, file dialog). */
  openPaths: (paths: string[]) => Promise<void>;
  closeViewer: () => void;
  /** Leave the quick viewer and show the full app (sidebar, gallery of the file's folder). */
  exitQuick: () => void;
  step: (delta: number) => void;
  goTo: (index: number) => void;
  setFullscreen: (v: boolean) => void;
}

/** Toasts, confirm dialog, About and keyboard-shortcut dialogs. */
export interface UiSlice {
  aboutOpen: boolean;
  shortcutsOpen: boolean;
  toast: ToastState | null;
  confirm: ConfirmRequest | null;

  setAboutOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  showToast: (
    message: string,
    tone?: "info" | "error",
    action?: ToastState["action"],
  ) => void;
  askConfirm: (req: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
}

/** Delete / restore / move with undo. */
export interface FileOpsSlice {
  undoStack: UndoEntry[];
  /** Bumped after every file operation so views can re-check what exists. */
  fsVersion: number;

  /** Delete to the Recycle Bin (asks before permanent deletion). `quiet` = no toast / undo entry. */
  deleteFiles: (
    paths: string[],
    opts?: { quiet?: boolean; allowPermanent?: boolean },
  ) => Promise<DeleteOutcome>;
  /** Restore recycled files to their original location. Returns restored paths. */
  restoreFiles: (paths: string[]) => Promise<string[]>;
  moveFiles: (
    paths: string[],
    dest: string,
  ) => Promise<{ from: string; to: string }[]>;
  undo: () => Promise<void>;
  /** Drop paths from the open folder and viewer after they were deleted or moved away. */
  forgetPaths: (paths: string[]) => void;
}

export type AppStore = CoreSlice & ViewerSlice & UiSlice & FileOpsSlice;

export type SetState = (patch: Partial<AppStore>) => void;
export type GetState = () => AppStore;
export type SliceCreator<T> = (set: SetState, get: GetState) => T;
