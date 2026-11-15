import { describe, expect, it } from "vitest";
import { type GalleryLayout, bandHits, normRect, rangeIndices, swipeOutcome, toggled } from "./selection";

const grid: GalleryLayout = { isGrid: true, count: 10, cols: 4, padTop: 16, padLeft: 16, rowH: 220, cellW: 176, gap: 10, itemH: 210, width: 800 };
const list: GalleryLayout = { isGrid: false, count: 50, cols: 1, padTop: 4, padLeft: 8, rowH: 40, cellW: 0, gap: 0, itemH: 40, width: 800 };

describe("rubber-band selection", () => {
  it("selects nothing in the padding before the first cell", () => {
    expect(bandHits(normRect(0, 0, 10, 10), grid)).toEqual([]);
  });
  it("selects a single cell", () => {
    expect(bandHits(normRect(30, 30, 40, 40), grid)).toEqual([0]);
  });
  it("selects a block across rows and columns, dragging in any direction", () => {
    // From inside cell 1 (row 0, col 1) to inside cell 6 (row 1, col 2)
    const a = bandHits(normRect(220, 40, 420, 260), grid);
    const b = bandHits(normRect(420, 260, 220, 40), grid);
    expect(a).toEqual([1, 2, 5, 6]);
    expect(b).toEqual(a);
  });
  it("skips the gaps between cells", () => {
    // x 193..201 lies in the 10 px gap between column 0 (16..192) and column 1 (202..378)
    expect(bandHits(normRect(193, 30, 201, 400), grid)).toEqual([]);
  });
  it("never returns indices past the last item", () => {
    expect(bandHits(normRect(0, 0, 2000, 5000), grid)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("works for list rows", () => {
    expect(bandHits(normRect(100, 50, 300, 130), list)).toEqual([1, 2, 3]);
  });
});

describe("range / toggle", () => {
  it("builds inclusive ranges both ways", () => {
    expect(rangeIndices(2, 5)).toEqual([2, 3, 4, 5]);
    expect(rangeIndices(5, 2)).toEqual([2, 3, 4, 5]);
    expect(rangeIndices(3, 3)).toEqual([3]);
  });
  it("toggles membership without mutating", () => {
    const s = new Set(["a"]);
    expect([...toggled(s, "b")].sort()).toEqual(["a", "b"]);
    expect([...toggled(s, "a")]).toEqual([]);
    expect([...s]).toEqual(["a"]);
  });
});

describe("swipe outcome", () => {
  it("right = keep, left = delete past the threshold", () => {
    expect(swipeOutcome(170, 0, 600)).toBe("keep");
    expect(swipeOutcome(-170, 0, 600)).toBe("delete");
  });
  it("snaps back when the drag is short and slow", () => {
    expect(swipeOutcome(60, 0.1, 600)).toBeNull();
    expect(swipeOutcome(-20, -2, 600)).toBeNull();
  });
  it("commits on a fast flick", () => {
    expect(swipeOutcome(60, 1.2, 600)).toBe("keep");
    expect(swipeOutcome(-60, -1.2, 600)).toBe("delete");
  });
  it("ignores a flick against the drag direction", () => {
    expect(swipeOutcome(60, -1.2, 600)).toBeNull();
  });
  it("uses a smaller threshold on narrow cards", () => {
    expect(swipeOutcome(90, 0, 300)).toBe("keep");
  });
});
