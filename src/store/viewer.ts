import { api } from "../lib/api";
import { entryFromPath, samePath, sortAndFilter } from "../lib/entries";
import { kindOf } from "../lib/formats";
import type { FileEntry } from "../lib/types";
import type { SliceCreator, ViewerSlice } from "./types";

export const createViewer: SliceCreator<ViewerSlice> = (set, get) => ({
  viewer: null,
  quick: false,
  fullscreen: false,

  openViewer: (items, index) => {
    if (!items.length) return;
    const i = Math.max(0, Math.min(items.length - 1, index));
    set({ viewer: { items, index: i } });
    get().addRecent(items[i].path);
  },

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
      if (paths.length)
        get().showToast(
          "None of the dropped items are supported media files.",
          "error",
        );
      return;
    }
    if (media.length > 1) {
      const entries = media.map(entryFromPath).filter(Boolean) as FileEntry[];
      get().openViewer(entries, 0);
      return;
    }

    // One file: show it right away, then list its folder in the background so ← / → work.
    const target = media[0];
    const first = entryFromPath(target);
    if (first) get().openViewer([first], 0);
    try {
      const t = await api.resolveOpenTarget(target);
      const listing = await api.listFolder(t.folder);
      set({
        folder: listing,
        lastFolder: listing.path,
        section: "browse",
        search: "",
      });
      const s = get().settings;
      const items = sortAndFilter(listing.files, s.sortKey, s.sortDesc, "all", "");
      const idx = items.findIndex((f) => samePath(f.path, target));
      const v = get().viewer;
      // Only swap in the folder if the user is still looking at that single file.
      const stillAlone =
        v && v.items.length === 1 && samePath(v.items[0].path, target);
      if (idx >= 0 && stillAlone) set({ viewer: { items, index: idx } });
    } catch {
      /* folder unreadable → keep the file alone */
    }
  },

  closeViewer: () => set({ viewer: null, quick: false }),

  exitQuick: () => set({ quick: false }),

  step: (delta) => {
    const v = get().viewer;
    if (!v || v.items.length < 2) return;
    const n = v.items.length;
    const i = get().settings.loopNavigation
      ? (((v.index + delta) % n) + n) % n
      : Math.max(0, Math.min(n - 1, v.index + delta));
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

  setFullscreen: (fullscreen) => set({ fullscreen }),
});
