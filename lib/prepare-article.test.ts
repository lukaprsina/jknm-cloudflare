import { describe, expect, test } from "vite-plus/test";
import { prepare_article } from "./prepare-article";

const header = (text: string, level: number) => ({ type: "header", data: { text, level } });
const prepare = (...blocks: { type: string; data: object }[]) => prepare_article({ blocks });

describe("prepare_article headings", () => {
  test("lists every heading with a stable id", () => {
    const only_title = prepare(header("Naslov", 1), { type: "paragraph", data: { text: "x" } });
    expect(only_title.headings).toEqual([{ id: "naslov", title: "Naslov", depth: 1 }]);

    const sectioned = prepare(header("Naslov", 1), header("Čudoviti <b>del</b>", 2));
    expect(sectioned.headings.map((h) => h.id)).toEqual(["naslov", "cudoviti-del"]);
  });

  test("first occurrence keeps the plain id, later duplicates get -1, -2", () => {
    const { headings } = prepare(header("A", 2), header("A", 3), header("a", 3));
    expect(headings.map((h) => h.id)).toEqual(["a", "a-1", "a-2"]);
  });

  test("an id never repeats, even when a later title slugifies to a suffixed id", () => {
    const { headings } = prepare(header("A", 2), header("A", 2), header("A 1", 2), header("A", 2));
    const ids = headings.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 2)).toEqual(["a", "a-1"]);
  });

  test("a title with no slug characters falls back to its block index; an empty one is skipped", () => {
    const { headings } = prepare(header("x", 1), header("???", 2), header("  ", 2));
    expect(headings.map((h) => h.id)).toEqual(["x", "section-1"]);
  });

  test("the rendered header block carries the same id", () => {
    const { blocks } = prepare(header("Jama", 2), header("Jama", 2));
    expect(blocks.map((b) => b.type === "header" && b.id)).toEqual(["jama", "jama-1"]);
  });
});

describe("prepare_article blocks", () => {
  test("no content yields nothing", () => {
    expect(prepare_article(null)).toEqual({ headings: [], blocks: [] });
  });

  test("lists accept string items and object items", () => {
    const { blocks } = prepare(
      { type: "list", data: { style: "ordered", items: ["a <b>b</b>"] } },
      {
        type: "list",
        data: {
          style: "unordered",
          items: [{ content: "x", items: [{ content: "y", items: [] }] }],
        },
      },
    );
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: true,
        items: [{ children: ["a ", { tag: "b", children: ["b"] }], items: [] }],
      },
      {
        type: "list",
        ordered: false,
        items: [{ children: ["x"], items: [{ children: ["y"], items: [] }] }],
      },
    ]);
  });

  test("images smaller than 500px on both sides are shown at double size", () => {
    const image = (width: number, height: number) => ({
      type: "image",
      data: { file: { url: "u", width, height }, caption: "" },
    });
    const { blocks } = prepare(image(480, 320), image(480, 600), image(1200, 800));
    expect(blocks.map((b) => b.type === "image" && [b.width, b.height])).toEqual([
      [960, 640],
      [480, 600],
      [1200, 800],
    ]);
  });

  test("a table right-aligns columns that are mostly measurements", () => {
    const { blocks } = prepare({
      type: "table",
      data: {
        withHeadings: true,
        content: [
          ["Jama", "Globina"],
          ["Ena", "~ 300 m"],
          ["Dva", "12,5 m"],
        ],
      },
    });
    expect(blocks[0]).toMatchObject({ type: "table", numeric_columns: [1] });
    expect(blocks[0].type === "table" && blocks[0].head).toEqual([["Jama"], ["Globina"]]);
  });

  test("only YouTube embeds render, on the privacy-enhanced host", () => {
    const embed = (service: string, url: string) => ({
      type: "embed",
      data: { service, embed: url, width: 580, height: 320, caption: "" },
    });
    const { blocks } = prepare(
      embed("youtube", "https://www.youtube.com/embed/abc"),
      embed("vimeo", "https://player.vimeo.com/video/1"),
    );
    expect(blocks).toMatchObject([
      { type: "embed", src: "https://www.youtube-nocookie.com/embed/abc" },
      { type: "unknown", kind: "embed" },
    ]);
  });

  test("an embed without a usable size gets 16:9; a YouTube URL that is not an /embed/ page is unknown", () => {
    const embed = (url: string, size: object) => ({
      type: "embed",
      data: { service: "youtube", embed: url, caption: "", ...size },
    });
    const ok = "https://www.youtube.com/embed/abc";
    const { blocks } = prepare(
      embed(ok, { width: 0, height: 0 }),
      embed(ok, {}),
      embed(ok, { width: 580, height: 0 }),
      embed(ok, { width: 640, height: 360 }),
      embed("https://www.youtube.com/watch?v=abc", { width: 580, height: 320 }),
    );
    expect(blocks).toMatchObject([
      { type: "embed", width: 16, height: 9 },
      { type: "embed", width: 16, height: 9 },
      { type: "embed", width: 16, height: 9 },
      { type: "embed", width: 640, height: 360 },
      { type: "unknown", kind: "embed" },
    ]);
  });

  test("a malformed block becomes unknown and the rest of the article still prepares", () => {
    const { blocks, headings } = prepare(
      { type: "image", data: {} },
      { type: "list", data: { style: "ordered" } },
      header("Jama", 2),
    );
    expect(blocks.map((b) => b.type)).toEqual(["unknown", "unknown", "header"]);
    expect(headings).toEqual([{ id: "jama", title: "Jama", depth: 2 }]);
  });

  test("an unrecognised block type is kept as unknown", () => {
    expect(prepare({ type: "quote", data: {} }).blocks).toEqual([
      { type: "unknown", kind: "quote" },
    ]);
  });
});
