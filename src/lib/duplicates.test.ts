import { describe, expect, it } from "vitest";
import { autoSelect, fullySelected, keeper, selectedBytes, visibleGroups } from "./duplicates";
import type { DupFile, DupGroup } from "./types";

const f = (name: string, size: number, modified: number, w?: number, h?: number): DupFile => ({
  path: `C:\\p\\${name}`,
  name,
  ext: name.split(".").pop()!,
  kind: "image",
  size,
  modified,
  width: w ?? null,
  height: h ?? null,
});

const exact: DupGroup = { kind: "exact", files: [f("a.jpg", 500, 3), f("a copy.jpg", 500, 5), f("a (2).jpg", 500, 1)], reclaimable: 1000 };
// A converted HEIC is smaller on disk but the same resolution; the half-size JPEG has fewer pixels.
const similar: DupGroup = {
  kind: "similar",
  files: [f("big.png", 900, 2, 1000, 800), f("photo.heic", 300, 1, 1000, 800), f("small.jpg", 100, 9, 500, 400)],
  reclaimable: 400,
};

describe("duplicate keep rules", () => {
  it("largest prefers more pixels, then bigger file", () => {
    expect(keeper(similar.files, "largest").name).toBe("big.png");
    expect(keeper(exact.files, "largest").name).toBe("a (2).jpg"); // all equal → oldest
  });
  it("oldest / newest use the modified time", () => {
    expect(keeper(exact.files, "oldest").name).toBe("a (2).jpg");
    expect(keeper(exact.files, "newest").name).toBe("a copy.jpg");
  });
  it("auto-select marks everything but one file per group", () => {
    const sel = autoSelect([exact, similar], "largest");
    expect(sel.size).toBe(4);
    expect(sel.has("C:\\p\\big.png")).toBe(false);
    expect(sel.has("C:\\p\\a (2).jpg")).toBe(false);
    expect(fullySelected([exact, similar], sel)).toEqual([]);
    expect(selectedBytes([exact, similar], sel)).toBe(500 + 500 + 300 + 100);
  });
});

describe("visible groups after delete / undo", () => {
  it("removes gone files, recomputes reclaimable and drops singletons", () => {
    const gone = new Set(["C:\\p\\a.jpg", "C:\\p\\a copy.jpg", "C:\\p\\small.jpg"]);
    const v = visibleGroups([exact, similar], gone);
    expect(v).toHaveLength(1);
    expect(v[0].files.map((x) => x.name)).toEqual(["big.png", "photo.heic"]);
    expect(v[0].reclaimable).toBe(300);
  });
  it("detects groups where every copy is selected", () => {
    const sel = new Set(exact.files.map((x) => x.path));
    expect(fullySelected([exact, similar], sel)).toEqual([exact]);
  });
});
