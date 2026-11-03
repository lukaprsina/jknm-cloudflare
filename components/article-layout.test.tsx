import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import type { Heading } from "@/lib/prepare-article";
import { ArticleLayout } from "./article-layout";

const heading = (id: string, depth: number): Heading => ({ id, title: id, depth });
const render = (headings: Heading[]) =>
  renderToStaticMarkup(
    <ArticleLayout headings={headings}>
      <p>telo</p>
    </ArticleLayout>,
  );

describe("ArticleLayout", () => {
  test("H2/H3 headings give a two-column page with the table of contents", () => {
    const html = render([heading("naslov", 1), heading("del", 2)]);
    expect(html).toContain('aria-label="Kazalo"');
    expect(html).toContain("lg:grid");
    expect(html).toContain("telo");
  });

  test("a lone title or deeper headings give a single centered column without one", () => {
    for (const headings of [
      [heading("naslov", 1)],
      [heading("naslov", 1), heading("del", 4)],
      [],
    ]) {
      const html = render(headings);
      expect(html).not.toContain('aria-label="Kazalo"');
      expect(html).not.toContain("lg:grid");
      expect(html).toContain("telo");
    }
  });
});
