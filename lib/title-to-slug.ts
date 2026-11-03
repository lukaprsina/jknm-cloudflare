import { strip_html_to_text } from "./inline-html";

/**
 * URL segment for an article title. Output must stay stable: stored slugs are
 * looked up by it when a retitled article is reverted.
 */
export function title_to_slug(title: string, fallback: () => string = () => crypto.randomUUID()) {
  const slug = strip_html_to_text(title)
    .toLowerCase()
    .replace(/–/g, "-")
    .replace(/[čšž]/g, (c) => (c === "č" ? "c" : c === "š" ? "s" : "z"))
    .replace(/[^a-z0-9\-_\s]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");

  return slug.length === 0 ? fallback() : slug;
}
