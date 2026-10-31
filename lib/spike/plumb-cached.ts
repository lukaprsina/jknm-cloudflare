import { sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { unstable_cache } from "next/cache";
import { db } from "./db";

type PlumbEnv = { IMG_BUCKET: R2Bucket };
const bucket = () => (env as unknown as PlumbEnv).IMG_BUCKET;

/** The "source of truth" is an R2 counter object (the Supabase session is read-only now). */
export async function getCounter(): Promise<number> {
  const o = await bucket().get("state/counter");
  return o ? Number(await o.text()) : 0;
}
export async function bumpCounter(): Promise<number> {
  const n = (await getCounter()) + 1;
  await bucket().put("state/counter", String(n));
  return n;
}

/** Cached read: truth from R2 plus a DB SELECT through the ALS proxy. `readAt` changes only on a miss. */
export const readPlumb = unstable_cache(
  async () => {
    const r = (await (db.execute(
      sql`select count(*)::int as n from articles`,
    ) as Promise<unknown>)) as {
      rows: { n: number }[];
    };
    return { counter: await getCounter(), articles: r.rows[0]?.n, readAt: Date.now() };
  },
  ["plumb-cache"],
  { tags: ["plumb"], revalidate: 3600 },
);
