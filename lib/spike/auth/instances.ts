// Workers wiring for auth. Two strategies, both over the ALS db seam (lib/spike/db.ts):
//   getAuth()        one betterAuth() per isolate, adapter gets the ALS `db` proxy
//   getRequestAuth() one betterAuth() per request db (memoised in a WeakMap keyed by the real db)
// Spike routes use a scratch Postgres schema, never the production auth tables.
import { db, getDb } from "../db";
import { getEnvString, waitUntil } from "../cf-env";
import { createAuth, type Auth, type CreateAuthOptions } from "./auth";
import { createAuthTables } from "./tables";

export const SCRATCH_SCHEMA = "spike_tmp_auth";
const tables = createAuthTables(SCRATCH_SCHEMA);

function config(useProxy: boolean): CreateAuthOptions {
  return {
    // CHANGED: the proxy for the isolate singleton, the concrete db for the per-request variant.
    db: (useProxy ? db : getDb()) as never,
    tables,
    secret: getEnvString("BETTER_AUTH_SECRET")!,
    googleClientId: getEnvString("GOOGLE_CLIENT_ID") ?? "spike-client-id",
    googleClientSecret: getEnvString("GOOGLE_CLIENT_SECRET") ?? "spike-client-secret",
    allowedHosts: ["jknm.si", "www.jknm.si", "localhost:*", "*.workers.dev"],
    waitUntil,
    useSecureCookies: getEnvString("SPIKE_SECURE") === "1" ? true : undefined,
  };
}

let singleton: Auth | undefined;
/** Strategy 2: once per isolate. */
export function getAuth(): Auth {
  return (singleton ??= createAuth(config(true)));
}

const perDb = new WeakMap<object, Auth>();
/** Strategy 1: per request (per concrete db). */
export function getRequestAuth(): Auth {
  const real = getDb() as object;
  let a = perDb.get(real);
  if (!a) perDb.set(real, (a = createAuth(config(false))));
  return a;
}

/** Spike only: one-off instance with an explicit useSecureCookies. */
export function buildAuthForCookieProbe(secure: boolean | undefined): Auth {
  return createAuth({ ...config(true), useSecureCookies: secure });
}

export function authFor(mode: string | null): Auth {
  return mode === "request" ? getRequestAuth() : getAuth();
}
