import { describe, expect, it } from "vitest";
import {
  type ViewTransform,
  clampCenter,
  fitScale,
  imageToView,
  nextZoomStep,
  orient,
  panBy,
  pickLevel,
  rotatedSize,
  unorient,
  viewToImage,
  visibleImageRect,
  zoomAt,
} from "./viewMath";

const view = { width: 1000, height: 800 };
const img = { width: 4000, height: 3000 };
const base: ViewTransform = { scale: 0.25, cx: 2000, cy: 1500, rotation: 0, flipH: false, flipV: false };

describe("fit & actual size", () => {
  it("fits large images inside the view", () => {
    expect(fitScale(img, view, 0, false)).toBeCloseTo(0.25);
    expect(fitScale(img, view, 90, false)).toBeCloseTo(800 / 4000);
  });
  it("never enlarges small images unless asked", () => {
    expect(fitScale({ width: 200, height: 100 }, view, 0, false)).toBe(1);
    expect(fitScale({ width: 200, height: 100 }, view, 0, true)).toBeCloseTo(5);
  });
  it("rotatedSize swaps axes for 90/270", () => {
    expect(rotatedSize(img, 90)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize(img, 180)).toEqual(img);
    expect(rotatedSize(img, -90)).toEqual({ width: 3000, height: 4000 });
  });
});

describe("transforms", () => {
  it("orient/unorient are inverse for every rotation & flip", () => {
    for (const rotation of [0, 90, 180, 270])
      for (const flipH of [false, true])
        for (const flipV of [false, true]) {
          const t = { rotation, flipH, flipV };
          const [x, y] = orient(3, -7, t);
          const [a, b] = unorient(x, y, t);
          expect(a).toBeCloseTo(3);
          expect(b).toBeCloseTo(-7);
        }
  });
  it("image ↔ view round-trips", () => {
    for (const rotation of [0, 90, 180, 270]) {
      const t = { ...base, rotation, flipH: true };
      const [vx, vy] = imageToView(1234, 567, t, view);
      const [ix, iy] = viewToImage(vx, vy, t, view);
      expect(ix).toBeCloseTo(1234);
      expect(iy).toBeCloseTo(567);
    }
  });
  it("image centre maps to view centre", () => {
    expect(imageToView(2000, 1500, base, view)).toEqual([500, 400]);
  });
  it("rotating 90° clockwise moves the image's top edge to the right", () => {
    const t = { ...base, rotation: 90 };
    const [vx] = imageToView(2000, 0, t, view);
    expect(vx).toBeGreaterThan(500);
  });
});

describe("zoom", () => {
  it("zoomAt keeps the point under the cursor fixed", () => {
    for (const rotation of [0, 90, 180, 270]) {
      const t = { ...base, rotation, flipV: rotation === 180 };
      const before = viewToImage(130, 620, t, view);
      const z = zoomAt(t, 2, 130, 620, view);
      const after = viewToImage(130, 620, z, view);
      expect(after[0]).toBeCloseTo(before[0]);
      expect(after[1]).toBeCloseTo(before[1]);
      expect(z.scale).toBe(2);
    }
  });
  it("steps through standard zoom levels including 100%", () => {
    expect(nextZoomStep(0.75, 1)).toBe(1);
    expect(nextZoomStep(1, 1)).toBe(1.25);
    expect(nextZoomStep(1, -1)).toBe(0.75);
    expect(nextZoomStep(64, 1)).toBe(64);
  });
  it("panBy moves the image with the pointer", () => {
    const p = panBy({ ...base, scale: 1 }, 100, 0);
    expect(p.cx).toBe(1900);
  });
});

describe("pyramid level selection", () => {
  it("uses the original pixels at ≥100%", () => {
    expect(pickLevel(1, 5)).toBe(0);
    expect(pickLevel(3, 5)).toBe(0);
  });
  it("never upsamples a reduced level", () => {
    expect(pickLevel(0.5, 5)).toBe(1);
    expect(pickLevel(0.49, 5)).toBe(1);
    expect(pickLevel(0.26, 5)).toBe(1);
    expect(pickLevel(0.25, 5)).toBe(2);
    expect(pickLevel(0.001, 5)).toBe(4);
  });
});

describe("pan limits", () => {
  it("centres images smaller than the view", () => {
    const t = clampCenter({ ...base, scale: 0.1, cx: 0, cy: 0 }, img, view);
    expect(t.cx).toBe(2000);
    expect(t.cy).toBe(1500);
  });
  it("stops at the image edge when zoomed in", () => {
    const t = clampCenter({ ...base, scale: 1, cx: -500, cy: 1500 }, img, view);
    expect(t.cx).toBe(500);
  });
  it("visible rect is clipped to the image", () => {
    const r = visibleImageRect({ ...base, scale: 1, cx: 0, cy: 0 }, view, img);
    expect(r).toEqual({ x0: 0, y0: 0, x1: 500, y1: 400 });
  });
});
