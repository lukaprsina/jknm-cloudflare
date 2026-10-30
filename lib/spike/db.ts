import { AsyncLocalStorage } from "node:async_hooks";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// satisfied by NodePgDatabase and PgliteDatabase (checked in db.pglite.test.ts)
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const als = new AsyncLocalStorage<{ db: Db }>();

export const runWithDb = <T>(db: Db, fn: () => T): T => als.run({ db }, fn);

export function getDb(): Db {
  const store = als.getStore();
  if (!store) throw new Error("no request-scoped db (wrap the entrypoint in runWithDb)");
  return store.db;
}

// Call sites keep `import { db }`. Methods are bound to the real db (see report: unbound
// methods lose `this`).
export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    const target = getDb();
    const v = Reflect.get(target, prop, target);
    return typeof v === "function" ? v.bind(target) : v;
  },
});
