import { api } from "../lib/api";
import { folderName, pathKey, plural, remapList } from "../lib/entries";
import { basename } from "../lib/formats";
import type { ApiError, OpResult } from "../lib/types";
import { scheduleSave } from "./persist";
import type {
  AppStore,
  DeleteOutcome,
  FileOpsSlice,
  GetState,
  SetState,
  SliceCreator,
  UndoEntry,
} from "./types";

const MAX_UNDO = 30;

type Move = { from: string; to: string };

const okMoves = (res: OpResult[]): Move[] =>
  res.filter((r) => r.ok && r.to).map((r) => ({ from: r.path, to: r.to! }));

/** "photo.jpg" for one failure, "3 files" for several. */
const describeFailed = (failed: OpResult[]) =>
  failed.length === 1 ? basename(failed[0].path) : plural(failed.length, "file");

function pushUndo(set: SetState, get: GetState, entry: UndoEntry) {
  set({ undoStack: [...get().undoStack, entry].slice(-MAX_UNDO) });
}

/** Keep favorites / recent pointing at files that moved. */
function remapPaths(set: SetState, get: GetState, moves: Move[]) {
  if (!moves.length) return;
  set({
    favorites: remapList(get().favorites, moves),
    recent: remapList(get().recent, moves),
  });
  scheduleSave(get);
}

export const createFileOps: SliceCreator<FileOpsSlice> = (set, get) => ({
  undoStack: [],
  fsVersion: 0,

  forgetPaths: (paths) => {
    if (!paths.length) return;
    const gone = new Set(paths.map(pathKey));
    const isGone = (p: string) => gone.has(pathKey(p));
    const { folder, viewer } = get();
    const patch: Partial<AppStore> = { fsVersion: get().fsVersion + 1 };
    if (folder)
      patch.folder = {
        ...folder,
        files: folder.files.filter((f) => !isGone(f.path)),
      };
    if (viewer) {
      const current = viewer.items[viewer.index];
      const items = viewer.items.filter((f) => !isGone(f.path));
      if (!items.length) {
        patch.viewer = null;
        patch.quick = false;
      } else if (current && !isGone(current.path))
        patch.viewer = { items, index: items.indexOf(current) };
      else {
        // Current item removed → show the one that took its place (or the new last one).
        const before = viewer.items
          .slice(0, viewer.index)
          .filter((f) => !isGone(f.path)).length;
        patch.viewer = { items, index: Math.min(before, items.length - 1) };
      }
    }
    set(patch);
  },

  deleteFiles: async (paths, opts = {}) => {
    const out: DeleteOutcome = { deleted: [], recycled: [], failed: [] };
    if (!paths.length) return out;
    let res: OpResult[];
    try {
      res = await api.deleteFiles(paths, !!opts.allowPermanent);
    } catch (e) {
      get().showToast((e as ApiError).message, "error");
      return out;
    }
    const needPerm = res.filter((r) => r.needsPermanent);
    if (needPerm.length) {
      const n = needPerm.length;
      const ok = await get().askConfirm({
        title: "Delete permanently?",
        message: `${plural(n, "file")} ${n === 1 ? "is" : "are"} on a drive without a Recycle Bin (removable or network drive). Deleting ${n === 1 ? "it" : "them"} can't be undone.`,
        confirmLabel: "Delete permanently",
        danger: true,
      });
      if (ok) {
        const perm = await api
          .deleteFiles(
            needPerm.map((r) => r.path),
            true,
          )
          .catch((): OpResult[] => []);
        res = res.filter((r) => !r.needsPermanent).concat(perm);
      }
    }
    for (const r of res) {
      if (r.ok) {
        out.deleted.push(r.path);
        if (r.recycled) out.recycled.push(r.path);
      } else if (!r.needsPermanent) out.failed.push(r);
    }
    get().forgetPaths(out.deleted);
    if (opts.quiet) return out;
    if (out.recycled.length)
      pushUndo(set, get, { kind: "delete", paths: out.recycled });
    if (out.failed.length) {
      get().showToast(
        `Couldn't delete ${describeFailed(out.failed)}: ${out.failed[0].error}`,
        "error",
      );
    } else if (out.deleted.length) {
      const msg = out.recycled.length
        ? `Moved ${plural(out.recycled.length, "item")} to the Recycle Bin`
        : `Permanently deleted ${plural(out.deleted.length, "item")}`;
      get().showToast(
        msg,
        "info",
        out.recycled.length
          ? { label: "Undo", run: () => void get().undo() }
          : undefined,
      );
    }
    return out;
  },

  restoreFiles: async (paths) => {
    if (!paths.length) return [];
    try {
      const res = await api.restoreFiles(paths);
      const failed = res.filter((r) => !r.ok);
      if (failed.length)
        get().showToast(
          `Couldn't restore ${basename(failed[0].path)}: ${failed[0].error}`,
          "error",
        );
      set({ fsVersion: get().fsVersion + 1 });
      await get().refreshFolder();
      return res.filter((r) => r.ok).map((r) => r.path);
    } catch (e) {
      get().showToast((e as ApiError).message, "error");
      return [];
    }
  },

  moveFiles: async (paths, dest) => {
    if (!paths.length) return [];
    let res: OpResult[];
    try {
      res = await api.moveFiles(paths, dest);
    } catch (e) {
      get().showToast((e as ApiError).message, "error");
      return [];
    }
    const moves = okMoves(res);
    const failed = res.filter((r) => !r.ok);
    get().forgetPaths(moves.map((m) => m.from));
    remapPaths(set, get, moves);
    if (moves.length) pushUndo(set, get, { kind: "move", moves, dest });
    if (failed.length) {
      get().showToast(
        `Couldn't move ${describeFailed(failed)}: ${failed[0].error}`,
        "error",
      );
    } else if (moves.length) {
      get().showToast(
        `Moved ${plural(moves.length, "item")} to ${folderName(dest)}`,
        "info",
        { label: "Undo", run: () => void get().undo() },
      );
    }
    return moves;
  },

  undo: async () => {
    const stack = get().undoStack;
    const last = stack[stack.length - 1];
    if (!last) {
      get().showToast("Nothing to undo.");
      return;
    }
    set({ undoStack: stack.slice(0, -1), toast: null });
    if (last.kind === "delete") {
      const restored = await get().restoreFiles(last.paths);
      if (restored.length)
        get().showToast(`Restored ${plural(restored.length, "item")}`);
      return;
    }
    try {
      const res = await api.moveExact(
        last.moves.map((m) => ({ from: m.to, to: m.from })),
      );
      const back = okMoves(res);
      remapPaths(set, get, back);
      set({ fsVersion: get().fsVersion + 1 });
      await get().refreshFolder();
      const failed = res.filter((r) => !r.ok);
      if (failed.length)
        get().showToast(
          `Couldn't move back ${basename(failed[0].path)}: ${failed[0].error}`,
          "error",
        );
      else get().showToast(`Moved ${plural(back.length, "item")} back`);
    } catch (e) {
      get().showToast((e as ApiError).message, "error");
    }
  },
});
