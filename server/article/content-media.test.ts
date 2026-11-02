import { describe, expect, test } from "vite-plus/test";
import { media_urls_in_content } from "./content-media";

const CDN = "https://gradivo.jknm.org";

describe("media_urls_in_content", () => {
  test("no content references no media", () => {
    expect(media_urls_in_content(null)).toEqual([]);
    expect(media_urls_in_content({ blocks: [] })).toEqual([]);
  });

  test("image and attachment blocks come in block order, without duplicates", () => {
    const content = {
      blocks: [
        { type: "image", data: { file: { url: `${CDN}/a.jpg` } } },
        { type: "paragraph", data: { text: "x" } },
        { type: "attaches", data: { file: { url: `${CDN}/b.pdf` } } },
        { type: "image", data: { file: { url: `${CDN}/a.jpg` } } },
      ],
    };
    expect(media_urls_in_content(content)).toEqual([`${CDN}/a.jpg`, `${CDN}/b.pdf`]);
  });

  test("a PDF linked from prose counts, after the block media", () => {
    const content = {
      blocks: [
        { type: "paragraph", data: { text: `<a href="${CDN}/zapisnik.pdf">zapisnik</a>` } },
        { type: "image", data: { file: { url: `${CDN}/a.jpg` } } },
      ],
    };
    expect(media_urls_in_content(content)).toEqual([`${CDN}/a.jpg`, `${CDN}/zapisnik.pdf`]);
  });

  test("links to other hosts are not media", () => {
    const content = {
      blocks: [{ type: "paragraph", data: { text: `<a href="https://example.com/x.pdf">x</a>` } }],
    };
    expect(media_urls_in_content(content)).toEqual([]);
  });
});
