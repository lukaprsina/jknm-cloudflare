import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "./db";
import { probe } from "./schema";

export const readCachedProbe = unstable_cache(
  async () => {
    const [row] = await db.select().from(probe).where(eq(probe.label, "cache"));
    return {
      counter: row?.counter,
      created_at: row?.created_at, // Date column
      readAt: Date.now(), // changes only when the fn actually ran
    };
  },
  ["spike-cache"],
  { tags: ["spike"], revalidate: 3600 },
);
