import { describe, expect, it } from "vite-plus/test";
import { natural_size, select_media } from "./plan";

const row = (id: string) => ({ id });

describe("select_media", () => {
  it("keeps what live articles use, and says why each other row is left behind", () => {
    const { kept, dropped } = select_media({
      rows: [row("used"), row("replaced"), row("orphan")],
      replaced_thumbnails: new Set(["replaced"]),
      used: new Set(["used"]),
    });
    expect(kept.map((r) => r.id)).toEqual(["used"]);
    expect(dropped).toEqual(
      new Map([
        ["replaced", "replaced thumbnail"],
        ["orphan", "unused"],
      ]),
    );
  });
});

describe("natural_size", () => {
  it("is the stored size for upright images", () => {
    for (const orientation of [undefined, 1, 2, 3, 4]) {
      expect(natural_size({ width: 480, height: 270, orientation })).toEqual({
        width: 480,
        height: 270,
      });
    }
  });

  it("swaps width and height for the quarter-turn orientations", () => {
    for (const orientation of [5, 6, 7, 8]) {
      expect(natural_size({ width: 480, height: 270, orientation })).toEqual({
        width: 270,
        height: 480,
      });
    }
  });
});
