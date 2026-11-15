import { create } from "zustand";
import { api } from "../lib/api";
import { basename, compareNames, extOf, kindOf } from "../lib/formats";
import type { ApiError, FileEntry, FolderListing, KindFilter, OpResult, PersistedState, Settings, SortKey } from "../lib/types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  viewerBackground: "default",
  customBackground: "#202024",
  enlargeSmallImages: false,
  pixelatedZoom: true,
  smoothTransitions: true,
  loopNavigation: true,
  showInfoPanel: false,
  thumbnailSize: 176,
  sortKey: "name",
  sortDesc: false,
  viewMode: "grid",
  kindFilter: "all",
  memoryBudgetMb: 1536,
  videoVolume: 80,
  videoHwdec: true,
  videoLoop: false,
  confirmBeforeLeavingVideo: false,
};

export type Section = "home" | "recent" | "favorites" | "browse" | "swipe" | "duplicates" | "settings";

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

const MAX_UNDO = 30;

const lower = (p: string) => p.toLowerCase();

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function folderName(p: string) {
  return basename(p.replace(/[\\/]+$/, "")) || p;
}

const MAX_RECENT = 60;

interface ViewerState {
  items: FileEntry[];
  index: number;
}

interface AppStore {
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

  viewer: ViewerState | null;
  fullscreen: boolean;
  aboutOpen: boolean;
  toast: ToastState | null;
  confirm: ConfirmRequest | null;
  undoStack: UndoEntry[];
  /** Bumped after every file operation so views can re-check what exists. */
  fsVersion: number;

  init: () => Promise<void>;
  setSection: (s: Section) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  openFolder: (path: string) => Promise<void>;
  refreshFolder: () => Promise<void>;
  setSearch: (q: string) => void;
  openViewer: (items: FileEntry[], index: number) => void;
  openPaths: (paths: string[]) => Promise<void>;
  closeViewer: () => void;
  step: (delta: number) => void;
  goTo: (index: number) => void;
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  clearRecent: () => void;
  toggleFavorite: (path: string) => void;
  setFullscreen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  showToast: (message: string, tone?: "info" | "error", action?: ToastState["action"]) => void;
  askConfirm: (req: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;

  /** Delete to the Recycle Bin (asks before permanent deletion). `quiet` = no toast / undo entry. */
  deleteFiles: (paths: string[], opts?: { quiet?: boolean; allowPermanent?: boolean }) => Promise<DeleteOutcome>;
  /** Restore recycled files to their original location. Returns restored paths. */
  restoreFiles: (paths: string[]) => Promise<string[]>;
  moveFiles: (paths: string[], dest: string) => Promise<{ from: string; to: string }[]>;
  undo: () => Promise<void>;
  /** Drop paths from the open folder and viewer after they were deleted or moved away. */
  forgetPaths: (paths: string[]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(get: () => AppStore) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = get();
    const state: PersistedState = {
      settings: s.settings,
      recent: s.recent,
      favorites: s.favorites,
      lastFolder: s.lastFolder,
    };
    api.saveState(state).catch((e) => console.warn("save_state failed", e));
  }, 400);
}

/** Build a FileEntry for a path we only know by name (recent/favorites/launch args). */
export function entryFromPath(path: string): FileEntry | null {
  const kind = kindOf(path);
  if (!kind) return null;
  return { path, name: basename(path), ext: extOf(path), kind, size: 0, modified: 0 };
}

export function sortAndFilter(files: FileEntry[], sortKey: SortKey, desc: boolean, filter: KindFilter, search: string): FileEntry[] {
  const q = search.trim().toLowerCase();
  const out = files.filter((f) => (filter === "all" || f.kind === filter) && (!q || f.name.toLowerCase().includes(q)));
  const dir = desc ? -1 : 1;
  out.sort((a, b) => {
    let c = 0;
    switch (sortKey) {
      case "date":
        c = a.modified - b.modified;
        break;
      case "size":
        c = a.size - b.size;
        break;
      case "type":
        c = a.ext.localeCompare(b.ext);
        break;
    }
    if (c === 0) c = compareNames(a.name, b.name);
    return c * dir;
  });
  return out;
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  section: "home",
  settings: DEFAULT_SETTINGS,
  recent: [],
  favorites: [],
  lastFolder: null,
  folder: null,
  folderLoading: false,
  folderError: null,
  search: "",
  viewer: null,
  fullscreen: false,
  aboutOpen: false,
  toast: null,
  confirm: null,
  undoStack: [],
  fsVersion: 0,

  init: async () => {
    try {
      const st = await api.loadState();
      if (st) {
        set({
          settings: { ...DEFAULT_SETTINGS, ...st.settings },
          recent: st.recent ?? [],
          favorites: st.favorites ?? [],
          lastFolder: st.lastFolder ?? null,
        });
      }
    } catch (e) {
      console.warn("load_state failed", e);
    }
    api.setMemoryBudget(get().settings.memoryBudgetMb).catch(() => {});
    set({ ready: true });
  },

  setSection: (section) => {
    set({ section, viewer: null });
    if (section === "browse" && !get().folder && get().lastFolder) {
      get().openFolder(get().lastFolder!);
    }
  },

  updateSettings: (patch) => {
    set({ settings: { ...get().settings, ...patch } });
    if (patch.memoryBudgetMb) api.setMemoryBudget(patch.memoryBudgetMb).catch(() => {});
    scheduleSave(get);
  },

  openFolder: async (path) => {
    set({ folderLoading: true, folderError: null, section: "browse", search: "" });
    try {
      const listing = await api.listFolder(path);
      set({ folder: listing, folderLoading: false, lastFolder: listing.path });
      scheduleSave(get);
    } catch (e) {
      set({ folderLoading: false, folderError: e as ApiError });
    }
  },

  refreshFolder: async () => {
    const f = get().folder;
    if (!f) return;
    try {
      const listing = await api.listFolder(f.path);
      set({ folder: listing });
    } catch (e) {
      set({ folderError: e as ApiError });
    }
  },

  setSearch: (search) => set({ search }),

  openViewer: (items, index) => {
    if (!items.length) return;
    const i = Math.max(0, Math.min(items.length - 1, index));
    set({ viewer: { items, index: i } });
    get().addRecent(items[i].path);
  },

  /** Open arbitrary paths (Explorer "Open with", drag & drop, file dialog). */
  openPaths: async (paths) => {
    const media = paths.filter((p) => kindOf(p));
    if (!media.length) {
      // A dropped folder → browse it
      if (paths.length === 1) {
        try {
          const t = await api.resolveOpenTarget(paths[0]);
          if (!t.file) {
            await get().openFolder(t.folder);
            return;
          }
        } catch {
          /* fallthrough */
        }
      }
      if (paths.length) get().showToast("None of the dropped items are supported media files.", "error");
      return;
    }
    if (media.length === 1) {
      // Single file: open it within the context of its folder so ← / → work.
      try {
        const t = await api.resolveOpenTarget(media[0]);
        const listing = await api.listFolder(t.folder);
        set({ folder: listing, lastFolder: listing.path, section: "browse", search: "" });
        const s = get().settings;
        const items = sortAndFilter(listing.files, s.sortKey, s.sortDesc, "all", "");
        const idx = items.findIndex((f) => f.path.toLowerCase() === media[0].toLowerCase());
        if (idx >= 0) {
          get().openViewer(items, idx);
          return;
        }
      } catch {
        /* folder unreadable → open file alone */
      }
      const e = entryFromPath(media[0]);
      if (e) get().openViewer([e], 0);
      return;
    }
    const entries = media.map(entryFromPath).filter(Boolean) as FileEntry[];
    get().openViewer(entries, 0);
  },

  closeViewer: () => set({ viewer: null }),

  step: (delta) => {
    const v = get().viewer;
    if (!v || v.items.length < 2) return;
    let i = v.index + delta;
    if (get().settings.loopNavigation) i = (i + v.items.length) % v.items.length;
    else i = Math.max(0, Math.min(v.items.length - 1, i));
    if (i === v.index) return;
    set({ viewer: { ...v, index: i } });
    get().addRecent(v.items[i].path);
  },

  goTo: (index) => {
    const v = get().viewer;
    if (!v) return;
    const i = Math.max(0, Math.min(v.items.length - 1, index));
    set({ viewer: { ...v, index: i } });
    get().addRecent(v.items[i].path);
  },

  addRecent: (path) => {
    const lower = path.toLowerCase();
    const recent = [path, ...get().recent.filter((p) => p.toLowerCase() !== lower)].slice(0, MAX_RECENT);
    set({ recent });
    scheduleSave(get);
  },

  removeRecent: (path) => {
    set({ recent: get().recent.filter((p) => p !== path) });
    scheduleSave(get);
  },

  clearRecent: () => {
    set({ recent: [] });
    scheduleSave(get);
  },

  toggleFavorite: (path) => {
    const lower = path.toLowerCase();
    const favs = get().favorites;
    const has = favs.some((p) => p.toLowerCase() === lower);
    set({ favorites: has ? favs.filter((p) => p.toLowerCase() !== lower) : [path, ...favs] });
    scheduleSave(get);
  },

  setFullscreen: (fullscreen) => set({ fullscreen }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  showToast: (message, tone = "info", action) => {
    const id = Date.now() + Math.random();
    set({ toast: { id, message, tone, action } });
    setTimeout(
      () => {
        if (get().toast?.id === id) set({ toast: null });
      },
      action ? 8000 : 4200,
    );
  },

  askConfirm: (req) =>
    new Promise<boolean>((resolve) => {
      get().confirm?.resolve(false);
      set({
        confirm: {
          ...req,
          resolve: (ok) => {
            set({ confirm: null });
            resolve(ok);
          },
        },
      });
    }),

  forgetPaths: (paths) => {
    if (!paths.length) return;
    const gone = new Set(paths.map(lower));
    const { folder, viewer } = get();
    const patch: Partial<AppStore> = { fsVersion: get().fsVersion + 1 };
    if (folder) patch.folder = { ...folder, files: folder.files.filter((f) => !gone.has(lower(f.path))) };
    if (viewer) {
      const current = viewer.items[viewer.index];
      const items = viewer.items.filter((f) => !gone.has(lower(f.path)));
      if (!items.length) patch.viewer = null;
      else if (current && !gone.has(lower(current.path))) patch.viewer = { items, index: items.indexOf(current) };
      else {
        // Current item removed → show the one that took its place (or the new last one).
        const before = viewer.items.slice(0, viewer.index).filter((f) => !gone.has(lower(f.path))).length;
        patch.viewer = { items, index: Math.min(before, items.length - 1) };
      }
    }
    set(patch);
  },

  deleteFiles: async (paths, opts = {}) => {
    const out: DeleteOutcome = { deleted: [], recycled: [], failed: [] };
    if (!paths.length) return out;
    let res: OpResult[];
    try {
      res = await api.deleteFiles(paths, !!opts.allowPermanent);
    } catch (e) {
      get().showToast((e as ApiError).message, "error");
      return out;
    }
    const needPerm = res.filter((r) => r.needsPermanent);
    if (needPerm.length) {
      const n = needPerm.length;
      const ok = await get().askConfirm({
        title: "Delete permanently?",
        message: `${plural(n, "file")} ${n === 1 ? "is" : "are"} on a drive without a Recycle Bin (removable or network drive). Deleting ${n === 1 ? "it" : "them"} can't be undone.`,
        confirmLabel: "Delete permanently",
        danger: true,
      });
      if (ok) {
        const perm = await api.deleteFiles(needPerm.map((r) => r.path), true).catch((): OpResult[] => []);
        res = res.filter((r) => !r.needsPermanent).concat(perm);
      }
    }
    for (const r of res) {
      if (r.ok) {
        out.deleted.push(r.path);
        if (r.recycled) out.recycled.push(r.path);
      } else if (!r.needsPermanent) out.failed.push(r);
    }
    get().forgetPaths(out.deleted);
    if (opts.quiet) return out;
    if (out.recycled.length) {
      set({ undoStack: [...get().undoStack, { kind: "delete" as const, paths: out.recycled }].slice(-MAX_UNDO) });
    }
    if (out.failed.length) {
      const f = out.failed[0];
      const what = out.failed.length === 1 ? basename(f.path) : plural(out.failed.length, "file");
      get().showToast(`Couldn't delete ${what}: ${f.error}`, "error");
    } else if (out.deleted.length) {
      const msg = out.recycled.length
        ? `Moved ${plural(out.recycled.length, "item")} to the Recycle Bin`
        : `Permanently deleted ${plural(out.deleted.length, "item")}`;
      get().showToast(msg, "info", out.recycled.length ? { label: "Undo", run: () => void get().undo() } : undefined);
    }
    return out;
  },

  restoreFiles: async (paths) => {
    if (!paths.length) return [];
    try {
      const res = await api.restoreFiles(paths);
      const failed = res.filter((r) => !r.ok);
      if (failed.length) get().showToast(`Couldn't restore ${basename(failed[0].path)}: ${failed[0].error}`, "error");
      set({ fsVersion: get().fsVersion + 1 });
      await get().refreshFolder();
      return res.filter((r) => r.ok).map((r) => r.path);
    } catch (e) {
      get().showToast((e as ApiError).message, "error");
      return [];
    }
  },

  moveFiles: async (paths, dest) => {
    if (!paths.length) return [];
    let res: OpResult[];
    try {
      res = await api.moveFiles(paths, dest);
    } catch (e) {
      get().showToast((e as ApiError).message, "error");
      return [];
    }
    const moves = res.filter((r) => r.ok && r.to).map((r) => ({ from: r.path, to: r.to! }));
    const failed = res.filter((r) => !r.ok);
    get().forgetPaths(moves.map((m) => m.from));
    remapPaths(set, get, moves);
    if (moves.length) set({ undoStack: [...get().undoStack, { kind: "move" as const, moves, dest }].slice(-MAX_UNDO) });
    if (failed.length) {
      const what = failed.length === 1 ? basename(failed[0].path) : plural(failed.length, "file");
      get().showToast(`Couldn't move ${what}: ${failed[0].error}`, "error");
    } else if (moves.length) {
      get().showToast(`Moved ${plural(moves.length, "item")} to ${folderName(dest)}`, "info", { label: "Undo", run: () => void get().undo() });
    }
    return moves;
  },

  undo: async () => {
    const stack = get().undoStack;
    const last = stack[stack.length - 1];
    if (!last) {
      get().showToast("Nothing to undo.");
      return;
    }
    set({ undoStack: stack.slice(0, -1), toast: null });
    if (last.kind === "delete") {
      const restored = await get().restoreFiles(last.paths);
      if (restored.length) get().showToast(`Restored ${plural(restored.length, "item")}`);
      return;
    }
    try {
      const res = await api.moveExact(last.moves.map((m) => ({ from: m.to, to: m.from })));
      const back = res.filter((r) => r.ok && r.to).map((r) => ({ from: r.path, to: r.to! }));
      remapPaths(set, get, back);
      set({ fsVersion: get().fsVersion + 1 });
      await get().refreshFolder();
      const failed = res.filter((r) => !r.ok);
      if (failed.length) get().showToast(`Couldn't move back ${basename(failed[0].path)}: ${failed[0].error}`, "error");
      else get().showToast(`Moved ${plural(back.length, "item")} back`);
    } catch (e) {
      get().showToast((e as ApiError).message, "error");
    }
  },
}));

/** Keep favorites / recent pointing at files that moved. */
function remapPaths(set: (p: Partial<AppStore>) => void, get: () => AppStore, moves: { from: string; to: string }[]) {
  if (!moves.length) return;
  const map = new Map(moves.map((m) => [lower(m.from), m.to]));
  const fix = (list: string[]) => list.map((p) => map.get(lower(p)) ?? p);
  set({ favorites: fix(get().favorites), recent: fix(get().recent) });
  scheduleSave(get);
}

export function isFavorite(favorites: string[], path: string): boolean {
  const l = path.toLowerCase();
  return favorites.some((p) => p.toLowerCase() === l);
}

// Dev-only handle for automated UI checks over DevTools.
if (import.meta.env.DEV) (window as unknown as { __vq: typeof useApp }).__vq = useApp;
