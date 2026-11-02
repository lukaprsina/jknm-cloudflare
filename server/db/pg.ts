import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Db } from "./index";
import * as schema from "./schema";

/**
 * The only module that knows about `pg`. One pool per invocation, over the
 * Hyperdrive connection string. Never call `pool.end()`: production RSC
 * streams Suspense content after `fetch` returns.
 */
export function create_pg_db(connection_string: string): Db {
  return drizzle(new Pool({ connectionString: connection_string, max: 5 }), { schema });
}
