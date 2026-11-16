import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "../lib/types";
import { entryFromPath, sortAndFilter } from "../lib/entries";
import { useApp } from "./app";

const f = (name: string, kind: "image" | "video", size: number, modified: number): FileEntry => ({
  path: `C:\\media\\${name}`,
  name,
  ext: name.split(".").pop()!.toLowerCase(),
  kind,
  size,
  modified,
});

const files = [
  f("IMG_10.jpg", "image", 300, 3),
  f("IMG_2.HEIC", "image", 100, 1),
  f("clip.mp4", "video", 900, 2),
  f("IMG_1.png", "image", 200, 4),
];

describe("gallery sorting & filtering", () => {
  it("sorts by name naturally (2 before 10)", () => {
    expect(sortAndFilter(files, "name", false, "all", "").map((x) => x.name)).toEqual(["clip.mp4", "IMG_1.png", "IMG_2.HEIC", "IMG_10.jpg"]);
  });
  it("sorts by date, size, type and descending", () => {
    expect(sortAndFilter(files, "date", false, "all", "").map((x) => x.modified)).toEqual([1, 2, 3, 4]);
    expect(sortAndFilter(files, "size", true, "all", "").map((x) => x.size)).toEqual([900, 300, 200, 100]);
    expect(sortAndFilter(files, "type", false, "all", "").map((x) => x.ext)).toEqual(["heic", "jpg", "mp4", "png"]);
  });
  it("filters by kind and search text", () => {
    expect(sortAndFilter(files, "name", false, "video", "").map((x) => x.name)).toEqual(["clip.mp4"]);
    expect(sortAndFilter(files, "name", false, "image", "img_1").map((x) => x.name)).toEqual(["IMG_1.png", "IMG_10.jpg"]);
  });
  it("classifies dropped paths", () => {
    expect(entryFromPath("D:\\x\\photo.HEIC")?.kind).toBe("image");
    expect(entryFromPath("D:\\x\\movie.MTS")?.kind).toBe("video");
    expect(entryFromPath("D:\\x\\notes.txt")).toBeNull();
  });
});

describe("file navigation", () => {
  beforeEach(() => {
    useApp.setState({ viewer: null, recent: [], favorites: [] });
    useApp.getState().updateSettings({ loopNavigation: true });
  });

  it("steps forward/backward and wraps around", () => {
    const s = useApp.getState();
    s.openViewer(files, 0);
    s.step(1);
    expect(useApp.getState().viewer!.index).toBe(1);
    s.step(-2);
    expect(useApp.getState().viewer!.index).toBe(3);
  });

  it("clamps without loop navigation", () => {
    const s = useApp.getState();
    s.updateSettings({ loopNavigation: false });
    s.openViewer(files, 3);
    s.step(1);
    expect(useApp.getState().viewer!.index).toBe(3);
    s.goTo(0);
    s.step(-1);
    expect(useApp.getState().viewer!.index).toBe(0);
  });

  it("records recent files (most recent first, deduplicated, case-insensitive)", () => {
    const s = useApp.getState();
    s.openViewer(files, 0);
    s.step(1);
    s.addRecent(files[0].path.toUpperCase());
    const recent = useApp.getState().recent;
    expect(recent[0]).toBe(files[0].path.toUpperCase());
    expect(recent).toHaveLength(2);
  });

  it("toggles favorites", () => {
    const s = useApp.getState();
    s.toggleFavorite(files[1].path);
    expect(useApp.getState().favorites).toEqual([files[1].path]);
    s.toggleFavorite(files[1].path.toLowerCase());
    expect(useApp.getState().favorites).toEqual([]);
  });
});

type Args = Record<string, unknown> | undefined;
const mockInvoke = (fn: (cmd: string, args: Args) => Promise<unknown>) =>
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => fn(cmd, args as Args)) as typeof invoke);

describe("file operations", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useApp.setState({
      folder: { path: "C:\\media", parent: "C:\\", dirs: [], files: [...files] },
      viewer: { items: [...files], index: 1 },
      favorites: [files[0].path],
      recent: [],
      undoStack: [],
      toast: null,
      confirm: null,
    });
  });

  it("forgetPaths removes files from the folder and keeps the viewer on the next item", () => {
    useApp.getState().forgetPaths([files[1].path.toUpperCase()]);
    const s = useApp.getState();
    expect(s.folder!.files.map((x) => x.name)).toEqual(["IMG_10.jpg", "clip.mp4", "IMG_1.png"]);
    expect(s.viewer!.items[s.viewer!.index].name).toBe("clip.mp4");
  });

  it("forgetPaths on the last item moves back, and closes the viewer when nothing is left", () => {
    useApp.setState({ viewer: { items: [...files], index: 3 } });
    useApp.getState().forgetPaths([files[3].path]);
    expect(useApp.getState().viewer!.items[useApp.getState().viewer!.index].name).toBe("clip.mp4");
    useApp.getState().forgetPaths(files.map((x) => x.path));
    expect(useApp.getState().viewer).toBeNull();
  });

  it("delete → Recycle Bin pushes an undo entry, and undo restores", async () => {
    mockInvoke(async (cmd, args) => {
      const paths = (args?.paths as string[]) ?? [];
      if (cmd === "delete_files" || cmd === "restore_files")
        return paths.map((p) => ({ path: p, to: null, ok: true, recycled: cmd === "delete_files", needsPermanent: false, error: null }));
      if (cmd === "list_folder") return { path: "C:\\media", parent: "C:\\", dirs: [], files };
      return null;
    });
    const out = await useApp.getState().deleteFiles([files[0].path, files[2].path]);
    expect(out.recycled).toHaveLength(2);
    expect(useApp.getState().folder!.files).toHaveLength(2);
    expect(useApp.getState().undoStack).toEqual([{ kind: "delete", paths: [files[0].path, files[2].path] }]);
    expect(useApp.getState().toast?.action?.label).toBe("Undo");

    await useApp.getState().undo();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("restore_files", { paths: [files[0].path, files[2].path] });
    expect(useApp.getState().undoStack).toHaveLength(0);
    expect(useApp.getState().folder!.files).toHaveLength(4);
  });

  it("asks before deleting permanently on drives without a Recycle Bin", async () => {
    mockInvoke(async (cmd, args) => {
      const paths = (args?.paths as string[]) ?? [];
      if (cmd === "delete_files" && !args?.allowPermanent)
        return paths.map((p) => ({ path: p, to: null, ok: false, recycled: false, needsPermanent: true, error: "no bin" }));
      if (cmd === "delete_files") return paths.map((p) => ({ path: p, to: null, ok: true, recycled: false, needsPermanent: false, error: null }));
      return null;
    });
    const pending = useApp.getState().deleteFiles([files[0].path]);
    await vi.waitFor(() => expect(useApp.getState().confirm).not.toBeNull());
    useApp.getState().confirm!.resolve(false); // cancel
    const out = await pending;
    expect(out.deleted).toHaveLength(0);
    expect(useApp.getState().folder!.files).toHaveLength(4);
    expect(useApp.getState().undoStack).toHaveLength(0);
  });

  it("move updates favorites and can be undone", async () => {
    mockInvoke(async (cmd, args) => {
      if (cmd === "move_files")
        return (args!.paths as string[]).map((p) => ({ path: p, to: p.replace("C:\\media", "D:\\keep"), ok: true, recycled: false, needsPermanent: false, error: null }));
      if (cmd === "move_exact")
        return (args!.moves as { from: string; to: string }[]).map((m) => ({ path: m.from, to: m.to, ok: true, recycled: false, needsPermanent: false, error: null }));
      if (cmd === "list_folder") return { path: "C:\\media", parent: "C:\\", dirs: [], files };
      return null;
    });
    await useApp.getState().moveFiles([files[0].path], "D:\\keep");
    expect(useApp.getState().favorites).toEqual(["D:\\keep\\IMG_10.jpg"]);
    expect(useApp.getState().folder!.files).toHaveLength(3);
    await useApp.getState().undo();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("move_exact", { moves: [{ from: "D:\\keep\\IMG_10.jpg", to: files[0].path }] });
    expect(useApp.getState().favorites).toEqual([files[0].path]);
  });
});

describe("opening a file from Explorer", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useApp.setState({ folder: null, viewer: null, quick: false, recent: [] });
  });

  it("shows the file immediately, then swaps in its folder so ← / → work", async () => {
    let release!: () => void;
    const listed = new Promise<void>((r) => (release = r));
    mockInvoke(async (cmd) => {
      if (cmd === "resolve_open_target") return { folder: "C:\\media", file: "C:\\media\\IMG_2.HEIC" };
      if (cmd === "list_folder") {
        await listed;
        return { path: "C:\\media", parent: "C:\\", dirs: [], files: [...files] };
      }
      return null;
    });
    const done = useApp.getState().openPaths(["C:\\media\\IMG_2.HEIC"]);
    // Before the folder listing arrives the viewer already shows the file on its own.
    expect(useApp.getState().viewer!.items.map((x) => x.name)).toEqual(["IMG_2.HEIC"]);
    release();
    await done;
    const v = useApp.getState().viewer!;
    expect(v.items).toHaveLength(4);
    expect(v.items[v.index].name).toBe("IMG_2.HEIC");
  });

  it("closing the quick viewer returns to the full app", () => {
    useApp.setState({ quick: true, viewer: { items: [files[0]], index: 0 } });
    useApp.getState().closeViewer();
    expect(useApp.getState().quick).toBe(false);
  });
});
