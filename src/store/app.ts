// The app store, composed from slices:
//   core.ts    — settings, library (recent / favorites), current folder, sections
//   viewer.ts  — full-screen viewer and quick (Explorer) mode
//   ui.ts      — toasts, confirm dialog, About
//   fileOps.ts — delete / restore / move with undo
import { create } from "zustand";
import { createCore } from "./core";
import { createFileOps } from "./fileOps";
import type { AppStore } from "./types";
import { createUi } from "./ui";
import { createViewer } from "./viewer";

export { DEFAULT_SETTINGS } from "./core";
export type {
  AppStore,
  ConfirmRequest,
  DeleteOutcome,
  Section,
  ToastState,
  UndoEntry,
} from "./types";

export const useApp = create<AppStore>((set, get) => ({
  ...createCore(set, get),
  ...createViewer(set, get),
  ...createUi(set, get),
  ...createFileOps(set, get),
}));

// Dev-only handle for automated UI checks over DevTools.
if (import.meta.env.DEV)
  (window as unknown as { __vq: typeof useApp }).__vq = useApp;
