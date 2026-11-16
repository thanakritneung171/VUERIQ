import type { SliceCreator, UiSlice } from "./types";

export const createUi: SliceCreator<UiSlice> = (set, get) => ({
  aboutOpen: false,
  toast: null,
  confirm: null,

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
});
