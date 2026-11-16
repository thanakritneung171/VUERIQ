import { describe, expect, it } from "vitest";
import { folderName, isFavorite, pushRecent, remapList, samePath, toggleIn } from "./entries";

describe("path list helpers", () => {
  it("compares Windows paths case-insensitively", () => {
    expect(samePath("C:\\Photos\\A.JPG", "c:\\photos\\a.jpg")).toBe(true);
    expect(isFavorite(["C:\\x\\Cat.png"], "c:\\X\\cat.PNG")).toBe(true);
  });

  it("moves a recent path to the front without duplicates, capped", () => {
    expect(pushRecent(["b", "A", "c"], "a", 3)).toEqual(["a", "b", "c"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });

  it("toggles a path in or out of a list", () => {
    expect(toggleIn(["a"], "b")).toEqual(["b", "a"]);
    expect(toggleIn(["a", "B"], "b")).toEqual(["a"]);
  });

  it("rewrites moved paths and keeps the rest", () => {
    const moves = [{ from: "C:\\in\\x.jpg", to: "D:\\out\\x.jpg" }];
    expect(remapList(["c:\\IN\\x.jpg", "C:\\in\\y.jpg"], moves)).toEqual(["D:\\out\\x.jpg", "C:\\in\\y.jpg"]);
  });

  it("names folders from paths with trailing separators", () => {
    expect(folderName("C:\\Photos\\Trip\\")).toBe("Trip");
  });
});
