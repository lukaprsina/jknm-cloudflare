import { parseDocument } from "htmlparser2";

/**
 * The inline HTML the editor stores in headings, paragraphs, list items and
 * cells, parsed once into an allowlisted tree. Two readers consume it: React
 * (`components/inline.tsx`) and `strip_html_to_text`. Pure and free of `node:`
 * imports, so the editor bundle may use it too.
 */
export type InlineNode =
  | string
  | { tag: "br" }
  | { tag: "a"; href: string | undefined; children: InlineNode[] }
  | { tag: (typeof FORMATTING_TAGS)[number]; children: InlineNode[] };

type ChildNode = ReturnType<typeof parseDocument>["children"][number];

const FORMATTING_TAGS = ["b", "i", "u", "sub", "sup", "code", "mark"] as const;
const DROPPED_TAGS = new Set(["script", "style"]);
const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Browsers ignore whitespace and control characters inside a scheme, so the check must too. */
function safe_href(href: string | undefined) {
  if (href === undefined) return undefined;
  // oxlint-disable-next-line no-control-regex -- stripping them is the point
  const compact = href.replace(/[\u0000- ]/g, "");
  return SAFE_SCHEME.test(compact) || !ANY_SCHEME.test(compact) ? href : undefined;
}

function convert(nodes: ChildNode[]): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    if (node.type === "text") return [node.data];
    if (node.type !== "tag") return [];
    if (DROPPED_TAGS.has(node.name)) return [];
    if (node.name === "br") return [{ tag: "br" }];

    const children = convert(node.children);
    if (node.name === "a") return [{ tag: "a", href: safe_href(node.attribs.href), children }];
    const tag = FORMATTING_TAGS.find((name) => name === node.name);
    return tag ? [{ tag, children }] : children;
  });
}

export function parse_inline(html: string): InlineNode[] {
  return convert(parseDocument(html).children);
}

export function inline_text(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (typeof node === "string") return node;
      return node.tag === "br" ? " " : inline_text(node.children);
    })
    .join("");
}

/** Plain text of inline HTML: tags gone, entities decoded, `<br>` and nbsp as spaces. */
export function strip_html_to_text(html: string) {
  return inline_text(parse_inline(html)).replaceAll("\u00a0", " ").trim();
}
