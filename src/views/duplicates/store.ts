// Duplicate-finder state: its own store so results survive visiting the viewer or another section.
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { api, isTauri } from "../../lib/api";
import { type KeepRule, autoSelect } from "../../lib/duplicates";
import type { ApiError, DupProgress, DupReport } from "../../lib/types";
import { useApp } from "../../store/app";

export type Sensitivity = "strict" | "normal" | "loose";
export const THRESHOLD: Record<Sensitivity, number> = { strict: 5, normal: 8, loose: 12 };
export const RULE_LABEL: Record<KeepRule, string> = {
  largest: "Keep the highest quality",
  oldest: "Keep the oldest",
  newest: "Keep the newest",
};

export interface DupStore {
  report: DupReport | null;
  scanning: boolean;
  progress: DupProgress | null;
  sel: Set<string>;
  gone: Set<string>;
  recursive: boolean;
  similar: boolean;
  sensitivity: Sensitivity;
  rule: KeepRule;
  /** Results scroll position, restored when coming back from the full viewer. */
  scrollTop: number;
  set: (p: Partial<DupStore>) => void;
}

// Own store: results survive opening the viewer or visiting another section.
export const useDups = create<DupStore>((set) => ({
  report: null,
  scanning: false,
  progress: null,
  sel: new Set(),
  gone: new Set(),
  recursive: true,
  similar: true,
  sensitivity: "normal",
  rule: "largest",
  scrollTop: 0,
  set: (p) => set(p),
}));

export async function runScan(folder: string) {
  const s = useDups.getState();
  s.set({ scanning: true, progress: { phase: "listing", done: 0, total: 0 }, report: null, sel: new Set(), gone: new Set(), scrollTop: 0 });
  let un: (() => void) | undefined;
  if (isTauri) un = await listen<DupProgress>("dup-progress", (e) => useDups.setState({ progress: e.payload }));
  try {
    const report = await api.findDuplicates(folder, { recursive: s.recursive, similar: s.similar, threshold: THRESHOLD[s.sensitivity] });
    if (report.cancelled) useDups.setState({ report: null });
    else useDups.setState({ report, sel: autoSelect(report.groups, useDups.getState().rule) });
  } catch (e) {
    useApp.getState().showToast((e as ApiError).message, "error");
  } finally {
    un?.();
    useDups.setState({ scanning: false, progress: null });
  }
}

/** Folder of `path` relative to the scanned root (null when it is the root itself). */
export function relFolder(root: string, path: string) {
  const dir = path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
  const r = root.replace(/[\\/]+$/, "");
  if (dir.toLowerCase() === r.toLowerCase()) return null;
  return dir.toLowerCase().startsWith(r.toLowerCase()) ? dir.slice(r.length + 1) : dir;
}
