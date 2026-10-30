import { sql } from "drizzle-orm";
import type { QueryResult } from "pg";
import { db } from "@/lib/spike/db";
import { withRequestDb, type Mode } from "@/lib/spike/pg-db";

export async function GET(req: Request) {
  const mode = (new URL(req.url).searchParams.get("mode") ?? "pool") as Mode;
  try {
    return Response.json(
      await withRequestDb(async () => {
        const t0 = Date.now();
        const exec = (q: ReturnType<typeof sql>) =>
          db.execute(q) as unknown as Promise<QueryResult>;
        const one = await exec(sql`select 1 as one`);
        const r = await exec(sql`select * from articles limit 5`);
        const concurrent = await Promise.all([exec(sql`select 1 as a`), exec(sql`select 2 as b`)]);
        return {
          mode,
          selectOne: one.rows,
          articlesRowCount: r.rowCount,
          articlesColumns: r.fields.map((f) => f.name),
          concurrentOk: concurrent.map((c) => c.rows.length),
          ms: Date.now() - t0,
        };
      }, mode),
    );
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message).slice(0, 300), name: (e as Error).name },
      { status: 500 },
    );
  }
}
