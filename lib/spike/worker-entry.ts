import handler from "vinext/server/fetch-handler";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runWithDb, type Db } from "./db";
import * as schema from "./schema";
import { env as cfEnv } from "cloudflare:workers";

export * from "vinext/server/fetch-handler";

type E = { HYPERDRIVE: { connectionString: string } };

// No explicit pool.end(): RSC streams the body after fetch() resolves, so ending the pool
// at return time would kill Suspense children that query later (tested via /spike/stream?end=1).
function scoped<T>(e: E, ctx: ExecutionContext, fn: () => T, endEarly = false): T {
  const pool = new Pool({ connectionString: e.HYPERDRIVE.connectionString, max: 5 });
  if (endEarly) {
    const r = runWithDb(drizzle(pool, { schema }) as unknown as Db, fn);
    ctx.waitUntil(
      Promise.resolve(r)
        .then(() => pool.end())
        .catch(() => {}),
    );
    return r;
  }
  return runWithDb(drizzle(pool, { schema }) as unknown as Db, fn);
}

export default {
  fetch(request: Request, env: E & { SPIKE_TOKEN?: string }, ctx: ExecutionContext) {
    // Deployed probe guard: /spike/* touches the production DB (scratch table only).
    if (
      env.SPIKE_TOKEN &&
      new URL(request.url).pathname.startsWith("/spike/") &&
      request.headers.get("x-spike-token") !== env.SPIKE_TOKEN
    )
      return new Response("forbidden", { status: 403 });
    const endEarly = new URL(request.url).searchParams.get("end") === "1";
    return scoped(env, ctx, () => handler.fetch(request, env as never, ctx), endEarly);
  },
  // /cdn-cgi/local/scheduled?cron=direct  -> import next/cache in the entry and call revalidateTag
  // /cdn-cgi/local/scheduled?cron=handler  -> invalidate through handler.fetch (internal route)
  async scheduled(c: ScheduledController, env: E, ctx: ExecutionContext) {
    await scoped(env, ctx, async () => {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const r = await (db.execute(
        sql`select count(*)::int as n from spike_hyperdrive_probe`,
      ) as Promise<unknown>);
      console.log(
        "[spike scheduled] db ok",
        JSON.stringify((r as { rows: unknown[] }).rows),
        "cron=",
        c.cron,
      );
      if (c.cron === "direct") {
        const { revalidateTag } = await import("next/cache");
        await revalidateTag("spike", { expire: 0 });
        console.log("[spike scheduled] direct revalidateTag returned without error");
      } else {
        const res = await handler.fetch(
          new Request("http://localhost/spike/cache/outside?fn=revalidateTag"),
          env as never,
          ctx,
        );
        console.log("[spike scheduled] via-handler revalidateTag", res.status, await res.text());
      }
    });
  },
};
void cfEnv;
