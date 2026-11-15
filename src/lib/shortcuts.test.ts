import { describe, expect, it } from "vitest";
import { resolveShortcut } from "./shortcuts";

const img = { isVideo: false, fullscreen: false };
const vid = { isVideo: true, fullscreen: false };

describe("image viewer shortcuts", () => {
  it.each([
    ["ArrowRight", { type: "step", delta: 1 }],
    ["ArrowLeft", { type: "step", delta: -1 }],
    [" ", { type: "step", delta: 1 }],
    ["+", { type: "zoomIn" }],
    ["=", { type: "zoomIn" }],
    ["-", { type: "zoomOut" }],
    ["0", { type: "fit" }],
    ["1", { type: "actualSize" }],
    ["r", { type: "rotate", dir: 1 }],
    ["l", { type: "rotate", dir: -1 }],
    ["h", { type: "flip", axis: "h" }],
    ["v", { type: "flip", axis: "v" }],
    ["f", { type: "toggleFullscreen" }],
    ["F11", { type: "toggleFullscreen" }],
    ["i", { type: "toggleInfo" }],
    ["s", { type: "toggleFavorite" }],
    ["Home", { type: "first" }],
    ["End", { type: "last" }],
    ["Escape", { type: "close" }],
  ])("%s", (key, action) => {
    expect(resolveShortcut({ key }, img)).toEqual(action);
  });

  it("Shift+arrows pan instead of navigating", () => {
    expect(resolveShortcut({ key: "ArrowLeft", shiftKey: true }, img)).toEqual({ type: "pan", dx: 80, dy: 0 });
  });
  it("Escape leaves full screen first", () => {
    expect(resolveShortcut({ key: "Escape" }, { ...img, fullscreen: true })).toEqual({ type: "exitFullscreen" });
  });
  it("ignores Alt combinations and unknown keys", () => {
    expect(resolveShortcut({ key: "f", altKey: true }, img)).toBeNull();
    expect(resolveShortcut({ key: "q" }, img)).toBeNull();
  });
});

describe("video viewer shortcuts", () => {
  it.each([
    [" ", { type: "togglePlay" }],
    ["k", { type: "togglePlay" }],
    ["ArrowRight", { type: "seek", seconds: 5 }],
    ["ArrowLeft", { type: "seek", seconds: -5 }],
    ["l", { type: "seek", seconds: 10 }],
    ["j", { type: "seek", seconds: -10 }],
    ["ArrowUp", { type: "volume", delta: 5 }],
    ["m", { type: "mute" }],
    [".", { type: "frameStep", dir: 1 }],
    [",", { type: "frameStep", dir: -1 }],
    ["]", { type: "speed", dir: 1 }],
    ["[", { type: "speed", dir: -1 }],
    ["Backspace", { type: "speed", dir: 0 }],
    ["PageDown", { type: "step", delta: 1 }],
    ["PageUp", { type: "step", delta: -1 }],
  ])("%s", (key, action) => {
    expect(resolveShortcut({ key }, vid)).toEqual(action);
  });
  it("Shift+arrow seeks 30 s", () => {
    expect(resolveShortcut({ key: "ArrowRight", shiftKey: true }, vid)).toEqual({ type: "seek", seconds: 30 });
  });
  it("Ctrl+arrow changes file in both modes", () => {
    expect(resolveShortcut({ key: "ArrowRight", ctrlKey: true }, vid)).toEqual({ type: "step", delta: 1 });
    expect(resolveShortcut({ key: "ArrowLeft", ctrlKey: true }, img)).toEqual({ type: "step", delta: -1 });
  });
});

describe("delete shortcut", () => {
  it("Delete removes the current file for images and videos", () => {
    expect(resolveShortcut({ key: "Delete" }, img)).toEqual({ type: "delete" });
    expect(resolveShortcut({ key: "Delete" }, vid)).toEqual({ type: "delete" });
  });
  it("modified Delete does nothing", () => {
    expect(resolveShortcut({ key: "Delete", ctrlKey: true }, img)).toBeNull();
    expect(resolveShortcut({ key: "Delete", shiftKey: true }, img)).toBeNull();
  });
});
