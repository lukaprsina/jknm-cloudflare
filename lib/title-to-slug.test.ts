import { describe, expect, test } from "vite-plus/test";
import golden from "./title-to-slug.golden.json";
import { title_to_slug } from "./title-to-slug";

describe("title_to_slug", () => {
  test("lowercases and hyphenates", () => {
    expect(title_to_slug("Velika jama")).toBe("velika-jama");
  });

  test("transliterates Slovenian č š ž", () => {
    expect(title_to_slug("Čudovit šopek žlahtnosti")).toBe("cudovit-sopek-zlahtnosti");
  });

  test("strips inline HTML from editor headings and decodes entities", () => {
    expect(title_to_slug("<b>Jama</b>&nbsp;pri&nbsp;mostu &amp; &lt;3")).toBe("jama-pri-mostu-3");
  });

  test("collapses runs of separators and trims them", () => {
    expect(title_to_slug("  --Jama –  vhod__ 2 --")).toBe("jama-vhod_-2");
  });

  test("falls back when nothing usable remains", () => {
    expect(title_to_slug("???", () => "fallback")).toBe("fallback");
  });
});

// Stored slugs are looked up by text when a retitled article is reverted, so
// the output must not drift. The corpus is every published article title on
// the live site paired with the slug the old `convert_title_to_url` produced,
// each checked against the slug stored in production when this was captured
// (2026-11-02). Expected values come from production, not from this code.
describe("title_to_slug against production", () => {
  test.each(golden as [string, string][])("%s", (title, slug) => {
    expect(title_to_slug(title)).toBe(slug);
  });
});
