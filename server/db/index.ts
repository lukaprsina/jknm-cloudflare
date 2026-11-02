import { AsyncLocalStorage } from "node:async_hooks";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Satisfied by both `NodePgDatabase` (production) and `PgliteDatabase` (tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const scope = new AsyncLocalStorage<Db>();

/**
 * Run `fn` with `database` as the ambient `db`. The Worker entry wraps each
 * `fetch`/`scheduled`/`queue` invocation in this; tests wrap in a pglite db.
 */
export const run_with_db = <T>(database: Db, fn: () => T): T => scope.run(database, fn);

/**
 * Ambient, request-scoped database. Throws outside `run_with_db`. Methods are
 * bound to the real instance, otherwise they lose `this`.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const current = scope.getStore();
    if (!current) throw new Error("db used outside run_with_db");
    const value = Reflect.get(current, prop, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
