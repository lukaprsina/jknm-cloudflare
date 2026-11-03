/** JSON for a `<script type="application/ld+json">` body: `<` is escaped so no value can close the tag. */
export function json_ld(data: object) {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

interface ArticleLd {
  title: string;
  excerpt: string;
  published_at: string | null;
  modified_at: string;
  authors: { display_name: string }[];
}

/** schema.org `Article` for a published page; `image` is left out without a thumbnail. */
export function article_json_ld(page: ArticleLd, url: string, image: string | undefined) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.excerpt,
    url,
    datePublished: page.published_at ?? undefined,
    dateModified: page.modified_at,
    author: page.authors.map((author) => ({ "@type": "Person", name: author.display_name })),
    image,
  };
}
