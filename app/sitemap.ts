import type { MetadataRoute } from "next";
import { CONTENT_PAGES } from "@/lib/content-pages";
import { article_path, page_url } from "@/lib/domains";
import { get_published } from "@/server/published";

// A safety net; publishing purges `/sitemap.xml` through the cache policy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await get_published().sitemap_entries();
  return [
    { url: page_url("/") },
    ...CONTENT_PAGES.map(({ slug }) => ({ url: page_url(`/${slug}`) })),
    ...articles.map(({ slug, published_at }) => ({
      url: page_url(article_path(slug)),
      lastModified: published_at,
    })),
  ];
}
