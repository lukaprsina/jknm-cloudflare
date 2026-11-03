/**
 * The five fixed evergreen pages (article kind `content`), in navigation order.
 * The nav and the content routes both read this list so they cannot drift.
 */
export const CONTENT_PAGES = [
  { slug: "zgodovina", title: "Zgodovina" },
  { slug: "raziskovanje", title: "Raziskovanje" },
  { slug: "publiciranje", title: "Publiciranje" },
  { slug: "varstvo", title: "Varstvo" },
  { slug: "klub", title: "Klub" },
] as const;

export type ContentPageSlug = (typeof CONTENT_PAGES)[number]["slug"];

export const is_content_page = (slug: string): slug is ContentPageSlug =>
  CONTENT_PAGES.some((page) => page.slug === slug);
