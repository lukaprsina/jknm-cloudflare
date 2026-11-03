import type { ArticleContentType } from "@/server/db/schema";
import { strip_html_to_text } from "./inline-html";
import { parse_stored_block } from "./stored-block";

const MAX_LENGTH = 200;

/**
 * A card's teaser: the running text of the article's paragraphs and lists, cut
 * at a word boundary. Derived, not read from `Article.excerpt`, which is empty
 * for every imported article.
 */
export function excerpt_of(content: ArticleContentType | null): string {
  const parts = (content?.blocks ?? []).flatMap((block) => {
    const stored = parse_stored_block(block);
    if (stored?.type === "paragraph") return [stored.data.text ?? ""];
    if (stored?.type === "list") {
      return stored.data.items.map((item) => (typeof item === "string" ? item : item.content));
    }
    return [];
  });
  const text = parts.map(strip_html_to_text).filter(Boolean).join(" ");
  if (text.length <= MAX_LENGTH) return text;
  return `${text.slice(0, MAX_LENGTH).replace(/\s*\S*$/, "")}…`;
}
