import type { ArticleContentType } from "../db/schema";

/** Origin media is served from. Existing `content_json` has these URLs baked in. */
export const MEDIA_ORIGIN = "https://gradivo.jknm.org";

const MEDIA_URL = new RegExp(`${MEDIA_ORIGIN.replace(/\./g, "\\.")}/[^"'\\s\\\\<>)]+`, "g");

/**
 * Every media URL an article's content points at: image/attachment blocks in
 * block order (that order is the gallery order), then media linked from inline
 * HTML (a PDF behind an `<a href>` in prose), which has no block position.
 * De-duplicated. The inline scan matches serialized block data rather than
 * parsing HTML, since any block type can carry inline HTML.
 */
export function media_urls_in_content(content: ArticleContentType | null | undefined): string[] {
  const urls = new Set<string>();
  if (!content) return [];

  for (const block of content.blocks) {
    if (block.type !== "image" && block.type !== "attaches") continue;
    const url = (block.data as { file?: { url?: string } }).file?.url;
    if (url) urls.add(url);
  }
  for (const block of content.blocks) {
    for (const url of JSON.stringify(block.data).match(MEDIA_URL) ?? []) urls.add(url);
  }
  return [...urls];
}
