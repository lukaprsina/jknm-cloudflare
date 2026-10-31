import handler from "vinext/server/fetch-handler";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { runWithDb, db, type Db } from "./db";
import * as schema from "./schema";

export * from "vinext/server/fetch-handler";

// SPIKE (06 worker plumbing): fetch + scheduled + queue composed with the vinext handler.
// State/log lives in R2 (IMG_BUCKET) because the Supabase pooler session is read-only now;
// db access in queue/cron is a SELECT through the ALS proxy.

type E = {
  HYPERDRIVE: { connectionString: string };
  IMG_BUCKET: R2Bucket;
  SPIKE_TOKEN?: string;
};

function scoped<T>(e: E, fn: () => T): T {
  const pool = new Pool({ connectionString: e.HYPERDRIVE.connectionString, max: 5 });
  return runWithDb(drizzle(pool, { schema }) as unknown as Db, fn);
}

async function plog(env: E, kind: string, detail: unknown) {
  const key = `log/${String(Date.now()).padStart(15, "0")}-${kind}`;
  await env.IMG_BUCKET.put(key, JSON.stringify({ at: new Date().toISOString(), kind, detail }));
}

async function dbProbe() {
  const r = (await (db.execute(
    sql`select count(*)::int as n from articles`,
  ) as Promise<unknown>)) as {
    rows: { n: number }[];
  };
  return r.rows[0]?.n;
}

/** mode: "direct" imports next/cache here (expected no-op); "handler" routes via the vinext handler. */
async function invalidate(mode: string, env: E, ctx: ExecutionContext) {
  if (mode === "direct") {
    const { revalidateTag } = await import("next/cache");
    await revalidateTag("plumb", { expire: 0 });
    return "direct revalidateTag returned";
  }
  if (mode === "handler") {
    const res = await handler.fetch(
      new Request("http://localhost/spike/cache/outside?fn=revalidateTag&tag=plumb"),
      env as never,
      ctx,
    );
    return `handler ${res.status} ${await res.text()}`;
  }
  return "none";
}

export default {
  fetch(request: Request, env: E, ctx: ExecutionContext) {
    // Deployed probe guard: everything except hashed build assets needs the token.
    const path = new URL(request.url).pathname;
    if (
      env.SPIKE_TOKEN &&
      !path.startsWith("/_next/static/") &&
      request.headers.get("x-spike-token") !== env.SPIKE_TOKEN
    )
      return new Response("forbidden", { status: 403 });
    return scoped(env, () => handler.fetch(request, env as never, ctx));
  },

  async scheduled(c: ScheduledController, env: E, ctx: ExecutionContext) {
    await scoped(env, async () => {
      const n = await dbProbe();
      const modeObj = await env.IMG_BUCKET.get("state/cronmode");
      const mode = modeObj ? (await modeObj.text()).trim() : "none";
      const r = await invalidate(mode, env, ctx);
      await plog(env, "cron", {
        cron: c.cron,
        scheduledTime: c.scheduledTime,
        articles: n,
        mode,
        r,
      });
    });
  },

  async queue(batch: MessageBatch<{ mode: string; id: string }>, env: E, ctx: ExecutionContext) {
    await scoped(env, async () => {
      for (const m of batch.messages) {
        const n = await dbProbe();
        const r = await invalidate(m.body.mode, env, ctx);
        await plog(env, "queue", {
          id: m.body.id,
          mode: m.body.mode,
          attempts: m.attempts,
          articles: n,
          r,
        });
        m.ack();
      }
    });
  },
};
