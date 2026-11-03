import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { CacheTag } from "../../lib/cache-policy";
import { db } from "../db";
import { create_published, type SlugResult } from "./create-published";

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

/** The public-read module with the framework cache around it. */
export const get_published = () => ({ by_slug });
