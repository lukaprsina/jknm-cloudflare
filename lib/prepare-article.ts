import type { ArticleContentType } from "@/server/db/schema";
import { parse_inline, strip_html_to_text, type InlineNode } from "./inline-html";
import { parse_stored_block, type StoredListItem } from "./stored-block";
import { title_to_slug } from "./title-to-slug";

export interface Heading {
  id: string;
  title: string;
  depth: number;
}

export interface ListItem {
  children: InlineNode[];
  items: ListItem[];
}

export type PreparedBlock =
  | { type: "header"; id: string | undefined; depth: number; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | {
      type: "image";
      url: string;
      /** Display size: already doubled for small images. */
      width: number;
      height: number;
      caption: InlineNode[] | null;
    }
  | {
      type: "table";
      head: InlineNode[][] | null;
      rows: InlineNode[][][];
      numeric_columns: number[];
    }
  | { type: "embed"; src: string; width: number; height: number; caption: InlineNode[] | null }
  | {
      type: "attaches";
      url: string;
      title: string;
      extension: string;
      size: number;
    }
  | { type: "unknown"; kind: string };

export interface PreparedArticle {
  /** Every heading, H1 included; the ids are the anchors of the rendered header blocks. */
  headings: Heading[];
  blocks: PreparedBlock[];
}

/** An embed dimension only sets an aspect ratio, so it must be a finite number above zero. */
const is_usable_dimension = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Turns stored editor content into what the renderer and the table of
 * contents need: inline HTML parsed once, heading ids assigned once, per-block
 * display decisions made. Pure, so it runs the same wherever it is called.
 * Heading ids are the old site's, because relative links such as
 * `/klub#eticni-kodeks` depend on them.
 */
export function prepare_article(content: ArticleContentType | null): PreparedArticle {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const issued = new Set<string>();

  function heading_id(title: string, block_index: number) {
    if (!title) return undefined;
    const slug = title_to_slug(title, () => `section-${block_index}`);
    // A later title such as "A 1" may slugify to an id already issued as "A"'s duplicate.
    let occurrence = seen.get(slug) ?? 0;
    let id = occurrence === 0 ? slug : `${slug}-${occurrence}`;
    while (issued.has(id)) id = `${slug}-${++occurrence}`;
    seen.set(slug, occurrence + 1);
    issued.add(id);
    return id;
  }

  function prepare_block(
    block: ArticleContentType["blocks"][number],
    index: number,
  ): PreparedBlock {
    const stored = parse_stored_block(block);
    if (!stored) return { type: "unknown", kind: block.type };
    switch (stored.type) {
      case "header": {
        const data = stored.data;
        const title = strip_html_to_text(data.text ?? "");
        const id = heading_id(title, index);
        if (id) headings.push({ id, title, depth: data.level });
        return { type: "header", id, depth: data.level, children: parse_inline(data.text ?? "") };
      }
      case "paragraph":
        return { type: "paragraph", children: parse_inline(stored.data.text ?? "") };
      case "list":
        return {
          type: "list",
          ordered: stored.data.style === "ordered",
          items: stored.data.items.map(list_item),
        };
      case "image": {
        const data = stored.data;
        return {
          type: "image",
          url: data.file.url,
          ...display_size(data.file),
          caption: inline_or_null(data.caption),
        };
      }
      case "table":
        return prepare_table(stored.data);
      case "embed": {
        const data = stored.data;
        const src = youtube_embed_src(data.service, data.embed);
        if (!src) break;
        // The size only sets the aspect ratio; without a usable one, assume 16:9.
        const { width, height } = data;
        const sized = is_usable_dimension(width) && is_usable_dimension(height);
        return {
          type: "embed",
          src,
          width: sized ? width : 16,
          height: sized ? height : 9,
          caption: inline_or_null(data.caption),
        };
      }
      case "attaches": {
        const data = stored.data;
        return {
          type: "attaches",
          url: data.file.url,
          title: data.title ?? "",
          extension: data.file.extension ?? "",
          size: data.file.size ?? 0,
        };
      }
    }
    // An embed that is not a YouTube /embed/ page.
    return { type: "unknown", kind: block.type };
  }

  // One malformed block must cost that block, not the whole public page.
  const blocks = (content?.blocks ?? []).map((block, index): PreparedBlock => {
    try {
      return prepare_block(block, index);
    } catch (error) {
      console.error(`prepare_article: block ${index} (${block.type}) is malformed`, error);
      return { type: "unknown", kind: block.type };
    }
  });

  return { headings, blocks };
}

const inline_or_null = (html: string | undefined) => (html ? parse_inline(html) : null);

function list_item(item: StoredListItem): ListItem {
  if (typeof item === "string") return { children: parse_inline(item), items: [] };
  return { children: parse_inline(item.content), items: (item.items ?? []).map(list_item) };
}

// Since 2008 every image came from the old site at ~480px, so small ones are
// shown doubled. Intentional; don't "fix" it.
const SMALL_IMAGE = 500;

function display_size({ width, height }: { width: number; height: number }) {
  const small = width < SMALL_IMAGE && height < SMALL_IMAGE;
  return small ? { width: width * 2, height: height * 2 } : { width, height };
}

const YOUTUBE_HOSTS = new Set(["www.youtube.com", "youtube.com", "www.youtube-nocookie.com"]);

/** The privacy-enhanced embed URL, or undefined for anything that is not a YouTube `/embed/` page. */
function youtube_embed_src(service: string, embed: string) {
  if (service !== "youtube") return undefined;
  const url = URL.parse(embed);
  if (!url || url.protocol !== "https:" || !YOUTUBE_HOSTS.has(url.hostname)) return undefined;
  if (url.username || url.password || url.port) return undefined;
  if (!url.pathname.startsWith("/embed/")) return undefined;
  url.hostname = "www.youtube-nocookie.com";
  return url.toString();
}

// Cell text such as "~ 300 m", "cca 1.200 m", "12,5 km" or "-".
const NUMERIC_CELL =
  /^(?:[~≈±><]|ca\.?|cca\.?)?\s*[-+]?\s*(?:\d+[\d\s.,]*\d*)\s*(?:[a-zA-Z°%µ/²³]+)?$|^[-–—/]$/;

/** A column is numeric when most of its filled cells are measurements; per-cell alignment would look ragged. */
function numeric_columns(rows: string[][]) {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: width }, (_, column) => column).filter((column) => {
    const cells = rows.map((row) => row[column]).filter((cell) => cell);
    return (
      cells.length > 0 &&
      cells.filter((cell) => NUMERIC_CELL.test(cell)).length / cells.length >= 0.8
    );
  });
}

function prepare_table(data: { content: string[][]; withHeadings?: boolean }): PreparedBlock {
  const head = data.withHeadings ? data.content[0] : undefined;
  const rows = data.withHeadings ? data.content.slice(1) : data.content;
  const cells = (row: string[]) => row.map((cell) => parse_inline(cell));
  return {
    type: "table",
    head: head ? cells(head) : null,
    rows: rows.map(cells),
    numeric_columns: numeric_columns(rows.map((row) => row.map(strip_html_to_text))),
  };
}
