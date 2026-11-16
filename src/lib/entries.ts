// Pure helpers for file entries and path lists (no store, no IPC).
import { basename, compareNames, extOf, kindOf } from "./formats";
import type { FileEntry, KindFilter, SortKey } from "./types";

/** Windows paths are case-insensitive: compare and key them in lower case. */
export const pathKey = (p: string) => p.toLowerCase();

export const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Display name of a folder path ("C:\Photos\" → "Photos"). */
export function folderName(p: string) {
  return basename(p.replace(/[\\/]+$/, "")) || p;
}

/** Build a FileEntry for a path we only know by name (recent/favorites/launch args). */
export function entryFromPath(path: string): FileEntry | null {
  const kind = kindOf(path);
  if (!kind) return null;
  return {
    path,
    name: basename(path),
    ext: extOf(path),
    kind,
    size: 0,
    modified: 0,
  };
}

export function sortAndFilter(
  files: FileEntry[],
  sortKey: SortKey,
  desc: boolean,
  filter: KindFilter,
  search: string,
): FileEntry[] {
  const q = search.trim().toLowerCase();
  const out = files.filter(
    (f) =>
      (filter === "all" || f.kind === filter) &&
      (!q || f.name.toLowerCase().includes(q)),
  );
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

export function isFavorite(favorites: string[], path: string): boolean {
  return favorites.some((p) => samePath(p, path));
}

/** Move `path` to the front of a most-recent-first list, without duplicates. */
export function pushRecent(list: string[], path: string, max: number): string[] {
  return [path, ...list.filter((p) => !samePath(p, path))].slice(0, max);
}

/** Toggle `path` in a list (added at the front). */
export function toggleIn(list: string[], path: string): string[] {
  return list.some((p) => samePath(p, path))
    ? list.filter((p) => !samePath(p, path))
    : [path, ...list];
}

/** Rewrite paths that moved (`from` → `to`), leaving the rest untouched. */
export function remapList(
  list: string[],
  moves: { from: string; to: string }[],
): string[] {
  const map = new Map(moves.map((m) => [pathKey(m.from), m.to]));
  return list.map((p) => map.get(pathKey(p)) ?? p);
}
