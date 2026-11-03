import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { CacheTag } from "../../lib/cache-policy";
import { db } from "../db";
import { create_published, type FeedCursor } from "./create-published";

const published = create_published({ db });

class NotFoundSignal extends Error {}

/**
 * A slug lookup cached for the `article` tag. `not_found` throws inside the
 * cached function so it is never stored: a crawler hitting junk slugs must not
 * grow the data cache. Everything else (found, redirect) is bounded by the real
 * slugs. Dates are ISO strings, so the cache's JSON round-trip loses nothing.
 * `key` must differ per lookup, or their entries would collide. Deduplicated
 * per request: `generateMetadata` and the page body both ask.
 */
function cached_lookup<Result extends { outcome: string }>(
  key: string,
  lookup: (slug: string) => Promise<Result>,
) {
  const cached = unstable_cache(
    async (slug: string) => {
      const result = await lookup(slug);
      if (result.outcome === "not_found") throw new NotFoundSignal();
      return result;
    },
    [key],
    // The window is a safety net; the `article` tag is the refresh mechanism.
    // Load-bearing even though the response store also holds the page: vinext
    // copies the tags of every `unstable_cache` call onto the page's stored
    // response, so this is the only way `updateTag("article")` reaches
    // `/novica/<slug>` and the club pages. Removing it silently stops them refreshing.
    { tags: ["article"] satisfies CacheTag[], revalidate: 3600 },
  );
  return cache(async (slug: string): Promise<Result | { outcome: "not_found" }> => {
    try {
      return await cached(slug);
    } catch (error) {
      if (error instanceof NotFoundSignal) return { outcome: "not_found" };
      throw error;
    }
  });
}

const by_slug = cached_lookup("published-by-slug", (slug) => published.by_slug(slug));
const by_content_page = cached_lookup("published-content-page", (slug) =>
  published.by_content_page(slug),
);

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
export const get_published = () => ({ by_slug, by_content_page, first_page, next_page });
