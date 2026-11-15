import { create } from "zustand";
import { api } from "../lib/api";
import { basename, compareNames, extOf, kindOf } from "../lib/formats";
import type { ApiError, FileEntry, FolderListing, KindFilter, PersistedState, Settings, SortKey } from "../lib/types";

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

export type Section = "home" | "recent" | "favorites" | "browse" | "settings";

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
  toast: { id: number; message: string; tone: "info" | "error" } | null;

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
  showToast: (message: string, tone?: "info" | "error") => void;
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
  showToast: (message, tone = "info") => {
    const id = Date.now();
    set({ toast: { id, message, tone } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 4200);
  },
}));

export function isFavorite(favorites: string[], path: string): boolean {
  const l = path.toLowerCase();
  return favorites.some((p) => p.toLowerCase() === l);
}

// Dev-only handle for automated UI checks over DevTools.
if (import.meta.env.DEV) (window as unknown as { __vq: typeof useApp }).__vq = useApp;
