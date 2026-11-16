import { api } from "../lib/api";
import type { PersistedState } from "../lib/types";
import type { GetState } from "./types";

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced write of settings, recent, favorites and last folder to state.json. */
export function scheduleSave(get: GetState) {
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
