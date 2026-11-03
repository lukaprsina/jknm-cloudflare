import { describe, expect, test } from "vite-plus/test";
import { excerpt_of } from "./excerpt";

const paragraph = (text: string) => ({ type: "paragraph", data: { text } });

describe("excerpt_of", () => {
  test("is the running text of paragraphs and lists, without headings, images or markup", () => {
    const excerpt = excerpt_of({
      blocks: [
        { type: "header", data: { text: "Naslov", level: 1 } },
        { type: "image", data: { file: { url: "/a.jpg", width: 1, height: 1 } } },
        paragraph("Prvi <b>odstavek</b>&nbsp;je tu."),
        { type: "list", data: { style: "unordered", items: ["Ena", { content: "Dve" }] } },
        paragraph("Konec."),
      ],
    });
    expect(excerpt).toBe("Prvi odstavek je tu. Ena Dve Konec.");
  });

  test("is cut at a word boundary with an ellipsis when long", () => {
    const excerpt = excerpt_of({ blocks: [paragraph("beseda ".repeat(100))] });
    expect(excerpt.length).toBeLessThanOrEqual(201);
    expect(excerpt).toMatch(/beseda…$/);
  });

  test("is empty without content", () => {
    expect(excerpt_of(null)).toBe("");
    expect(excerpt_of({ blocks: [{ type: "mystery", data: {} }] })).toBe("");
  });
});
