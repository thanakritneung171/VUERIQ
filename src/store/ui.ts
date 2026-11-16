import type { SliceCreator, UiSlice } from "./types";

export const createUi: SliceCreator<UiSlice> = (set, get) => ({
  aboutOpen: false,
  shortcutsOpen: false,
  toast: null,
  confirm: null,

  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

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
});
