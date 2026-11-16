import { api } from "../lib/api";
import { pushRecent, toggleIn } from "../lib/entries";
import type { ApiError, Settings } from "../lib/types";
import { scheduleSave } from "./persist";
import type { CoreSlice, SliceCreator } from "./types";

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
  quickViewer: true,
};

const MAX_RECENT = 60;

export const createCore: SliceCreator<CoreSlice> = (set, get) => ({
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
    set({ section, viewer: null, quick: false });
    const { folder, lastFolder } = get();
    if (section === "browse" && !folder && lastFolder) get().openFolder(lastFolder);
  },

  updateSettings: (patch) => {
    set({ settings: { ...get().settings, ...patch } });
    if (patch.memoryBudgetMb)
      api.setMemoryBudget(patch.memoryBudgetMb).catch(() => {});
    scheduleSave(get);
  },

  openFolder: async (path) => {
    set({
      folderLoading: true,
      folderError: null,
      section: "browse",
      search: "",
    });
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
      set({ folder: await api.listFolder(f.path) });
    } catch (e) {
      set({ folderError: e as ApiError });
    }
  },

  setSearch: (search) => set({ search }),

  addRecent: (path) => {
    set({ recent: pushRecent(get().recent, path, MAX_RECENT) });
    scheduleSave(get);
  },

  removeRecent: (path) => {
    set({ recent: get().recent.filter((p) => p !== path) });
    scheduleSave(get);
  },

  clearRecent: () => {
    const before = get().recent;
    if (!before.length) return;
    set({ recent: [] });
    scheduleSave(get);
    get().showToast("Cleared recent files.", "info", {
      label: "Undo",
      run: () => {
        set({ recent: before });
        scheduleSave(get);
      },
    });
  },

  toggleFavorite: (path) => {
    set({ favorites: toggleIn(get().favorites, path) });
    scheduleSave(get);
  },
});
