import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

import type { FileEntry } from "../lib/types";
import { entryFromPath, sortAndFilter, useApp } from "./app";

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
