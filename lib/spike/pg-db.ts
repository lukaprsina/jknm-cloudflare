// Only file (besides cf-env) that knows about `pg`. Imported by the worker entry / route handlers.
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { getHyperdriveConnectionString } from "./cf-env";
import { runWithDb, type Db } from "./db";
import * as schema from "./schema";

export type Mode = "client" | "pool";

/** Run `fn` with a request-scoped db. Closes the connection afterwards. */
export async function withRequestDb<T>(fn: () => Promise<T>, mode: Mode = "pool"): Promise<T> {
  const connectionString = getHyperdriveConnectionString();
  if (mode === "client") {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      return await runWithDb(drizzle(client, { schema }) as unknown as Db, fn);
    } finally {
      await client.end().catch(() => {});
    }
  }
  const pool = new Pool({ connectionString, max: 5 });
  try {
    return await runWithDb(drizzle(pool, { schema }) as unknown as Db, fn);
  } finally {
    await pool.end().catch(() => {});
  }
}
