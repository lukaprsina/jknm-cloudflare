import { revalidatePath, updateTag } from "next/cache";
import { invalidations_for } from "../lib/cache-policy";
import type { Emit } from "./events";

/**
 * Production `Emit`: translates a domain event into data-cache and route-cache
 * invalidations. The rules live in `lib/cache-policy`; nothing is decided here.
 *
 * `updateTag`, never `revalidateTag(tag, "max")`: every caller is a Server
 * Action, and "max" is stale-while-revalidate, so the request right after a
 * mutation could still read the pre-mutation value. `updateTag` makes the next
 * reader wait for fresh data, which at this site's traffic is a clear trade for
 * not shipping read-your-own-writes bugs. `revalidatePath` alone is not enough:
 * it clears the route cache but not tagged data-cache entries.
 */
export const apply_server_invalidations: Emit = (event) => {
  const { tags, paths } = invalidations_for(event);
  for (const tag of tags) updateTag(tag);
  for (const path of paths) revalidatePath(path);
};
