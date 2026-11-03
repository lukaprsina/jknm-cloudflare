import { describe, expect, test } from "vite-plus/test";
import { parse_inline, strip_html_to_text } from "./inline-html";

describe("parse_inline", () => {
  test("keeps allowlisted formatting and unwraps everything else", () => {
    expect(parse_inline('a <b>bold</b> <span style="x">span</span><sup>2</sup>')).toEqual([
      "a ",
      { tag: "b", children: ["bold"] },
      " ",
      "span",
      { tag: "sup", children: ["2"] },
    ]);
  });

  test("br is a void node", () => {
    expect(parse_inline("a<br>b<br/>c")).toEqual(["a", { tag: "br" }, "b", { tag: "br" }, "c"]);
  });

  test("links keep href only", () => {
    expect(parse_inline('<a href="/klub#etika" onclick="x()" class="c">klub</a>')).toEqual([
      { tag: "a", href: "/klub#etika", children: ["klub"] },
    ]);
  });

  test.each(["javascript:alert(1)", " JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x"])(
    "drops the href of an unsafe link: %s",
    (href) => {
      expect(parse_inline(`<a href="${href}">x</a>`)).toEqual([
        { tag: "a", href: undefined, children: ["x"] },
      ]);
    },
  );

  test.each(["https://jknm.si", "http://a.b", "mailto:a@b.si", "tel:+386", "/relative", "#hash"])(
    "keeps a safe href: %s",
    (href) => {
      expect(parse_inline(`<a href="${href}">x</a>`)).toEqual([
        { tag: "a", href, children: ["x"] },
      ]);
    },
  );

  test("script and style content never becomes text", () => {
    expect(parse_inline("a<script>alert(1)</script><style>p{}</style>b")).toEqual(["a", "b"]);
  });

  test("decodes entities, including a double-encoded nbsp, and survives malformed tags", () => {
    expect(parse_inline("a &amp; b &amp;nbsp;<b>open")).toEqual([
      "a & b &nbsp;",
      { tag: "b", children: ["open"] },
    ]);
  });
});

describe("strip_html_to_text", () => {
  test("plain text with entities decoded and nbsp as a space", () => {
    expect(strip_html_to_text("<b>Jama</b>&nbsp;pri &amp; &lt;3")).toBe("Jama pri & <3");
  });

  test("br becomes a space and script text is dropped", () => {
    expect(strip_html_to_text("a<br>b<script>x</script>")).toBe("a b");
  });

  test("trims", () => {
    expect(strip_html_to_text("  <i> a </i> ")).toBe("a");
  });
});
