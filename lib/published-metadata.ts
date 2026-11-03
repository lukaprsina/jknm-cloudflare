import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { PublishedPage } from "@/server/published/create-published";
import { image_url } from "./image-url";

/**
 * Title, description, canonical URL and social preview of a published page.
 * Only news articles carry publish and modify times; a club page is not news.
 */
export function published_metadata(
  page: PublishedPage,
  url: string,
  kind: "article" | "content",
): Metadata {
  return {
    title: page.title,
    description: page.excerpt,
    alternates: { canonical: url },
    openGraph: {
      type: kind === "article" ? "article" : "website",
      url,
      title: page.title,
      description: page.excerpt,
      ...(kind === "article" && {
        publishedTime: page.published_at ?? undefined,
        modifiedTime: page.modified_at,
      }),
      // No key at all without a thumbnail, so the default preview image (#10) can apply.
      ...(page.thumbnail && { images: [image_url(page.thumbnail.url, 1200)] }),
    },
  };
}

/**
 * Answers 404 for a page the public may not see. The render is made dynamic
 * first, because a dynamic render is never stored, so junk URLs cannot
 * accumulate cache entries.
 */
export async function not_found_uncached(): Promise<never> {
  await connection();
  notFound();
}
