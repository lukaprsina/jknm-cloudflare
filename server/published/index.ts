import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { CacheTag } from "../../lib/cache-policy";
import { db } from "../db";
import { create_published, type FeedCursor, type SlugResult } from "./create-published";

const published = create_published({ db });

class NotFoundSignal extends Error {}

/**
 * `not_found` throws inside the cached function so it is never stored: a
 * crawler hitting junk slugs must not grow the data cache. Everything else
 * (found, redirect) is bounded by the real slugs. Dates are ISO strings, so
 * the cache's JSON round-trip loses nothing.
 */
const cached_by_slug = unstable_cache(
  async (slug: string) => {
    const result = await published.by_slug(slug);
    if (result.outcome === "not_found") throw new NotFoundSignal();
    return result;
  },
  ["published-by-slug"],
  // The window is a safety net; the `article` tag is the refresh mechanism.
  // Load-bearing even though the response store also holds the page: vinext
  // copies the tags of every `unstable_cache` call onto the page's stored
  // response, so this is the only way `updateTag("article")` reaches
  // `/novica/<slug>`. Removing it silently stops article pages refreshing.
  { tags: ["article"] satisfies CacheTag[], revalidate: 3600 },
);

/** Deduplicated per request: `generateMetadata` and the page body both ask. */
const by_slug = cache(async (slug: string): Promise<SlugResult> => {
  try {
    return await cached_by_slug(slug);
  } catch (error) {
    if (error instanceof NotFoundSignal) return { outcome: "not_found" };
    throw error;
  }
});

/** One featured card, then rows that stay full at 2 and 3 columns. */
export const FIRST_PAGE_SIZE = 13;
export const NEXT_PAGE_SIZE = 12;

/**
 * Only the first page is cached: it is what `/` renders. A later page is keyed
 * by a client-supplied cursor, so caching it would let visitors grow the cache.
 * Cards carry author names, so a rename must reach them: hence `authors`.
 */
const first_page = unstable_cache(
  () => published.feed({ limit: FIRST_PAGE_SIZE }),
  ["published-feed-first-page"],
  { tags: ["homepage-feed", "authors"] satisfies CacheTag[], revalidate: 3600 },
);

const next_page = (after: FeedCursor) => published.feed({ limit: NEXT_PAGE_SIZE, after });

/** The public-read module with the framework cache around it. */
export const get_published = () => ({ by_slug, first_page, next_page });
