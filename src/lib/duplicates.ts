// Pure helpers for the duplicate finder (unit tested).
import type { DupFile, DupGroup } from "./types";

export type KeepRule = "largest" | "oldest" | "newest";

const pixels = (f: DupFile) => (f.width ?? 0) * (f.height ?? 0);

/** The file to keep in a group under a rule. */
export function keeper(files: DupFile[], rule: KeepRule): DupFile {
  return [...files].sort((a, b) => {
    switch (rule) {
      case "largest":
        return pixels(b) - pixels(a) || b.size - a.size || a.modified - b.modified;
      case "oldest":
        return a.modified - b.modified || b.size - a.size;
      case "newest":
        return b.modified - a.modified || b.size - a.size;
    }
  })[0];
}

/** Select every file except the keeper of each group. */
export function autoSelect(groups: DupGroup[], rule: KeepRule): Set<string> {
  const out = new Set<string>();
  for (const g of groups) {
    const k = keeper(g.files, rule);
    for (const f of g.files) if (f.path !== k.path) out.add(f.path);
  }
  return out;
}

/** Drop files that no longer exist; drop groups left with fewer than two files. */
export function visibleGroups(groups: DupGroup[], gone: ReadonlySet<string>): DupGroup[] {
  const out: DupGroup[] = [];
  for (const g of groups) {
    const files = g.files.filter((f) => !gone.has(f.path));
    if (files.length < 2) continue;
    const total = files.reduce((s, f) => s + f.size, 0);
    const largest = Math.max(...files.map((f) => f.size));
    out.push({ ...g, files, reclaimable: total - largest });
  }
  return out;
}

/** Groups in which every remaining file is selected (deleting would leave no copy). */
export function fullySelected(groups: DupGroup[], sel: ReadonlySet<string>): DupGroup[] {
  return groups.filter((g) => g.files.every((f) => sel.has(f.path)));
}

export function selectedBytes(groups: DupGroup[], sel: ReadonlySet<string>): number {
  let n = 0;
  for (const g of groups) for (const f of g.files) if (sel.has(f.path)) n += f.size;
  return n;
}
