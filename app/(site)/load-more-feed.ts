"use server";

import { z } from "zod";
import { get_published } from "@/server/published";
import type { FeedPage } from "@/server/published/create-published";

// Postgres' text form of a timestamptz; anything else would fail the SQL cast.
const cursor = z.object({
  published_at: z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?([+-]\d\d(:\d\d)?)?$/),
  id: z.uuid(),
});

/**
 * The homepage's "load more". A plain server function rather than `action()`:
 * it is public, and it touches no session and revalidates nothing, so the
 * cached `/` stays cached.
 */
export async function load_more_feed(after: unknown): Promise<FeedPage> {
  return get_published().next_page(cursor.parse(after));
}
