# Workers port: unknowns, verdicts and a search spike

Researched 2026-10-30. Read-only pass over primary sources only. Nothing was run (no `vp dev`, no deploy, no DB access), so every "works" below is a reading of docs/source unless it says **tested**. Nothing is tested. Anything I could not source locally is tagged **UNVERIFIED**.

Installed vs. cloned versions matter: installed `vinext` 1.3.1 (clone is 1.4.0), `@vinext/cloudflare` 1.2.1 (clone 1.3.0), `@cloudflare/workers-response-store` 1.1.3 (clone 1.1.4), `@cloudflare/config` 0.28.0, `@cloudflare/vite-plugin` 2.0.0-beta.v.4, `cf` 1.0.0-beta.21. Where I cite vinext behavior I read the installed `node_modules/vinext/dist` and only used the clone for docs and comments.

## Summary of verdicts

| #   | Question           | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Env/bindings       | Declare everything in `cloudflare.config.ts`: `bindings.hyperdrive/r2/secret/text/json`, `triggers.scheduled`. `process.env` **is** populated in workerd at compat date 2026-10-26, but only from declared text/json/secret bindings; undeclared `.env.local` keys are invisible to the Worker. `import { env } from "cloudflare:workers"` works at module scope for vars/secrets, never for I/O. `NEXT_PUBLIC_*` are inlined at build time from the Node `process.env`. Cron needs a custom worker entry.                                                                                |
| 2   | Drizzle + Postgres | Use `pg` (>= 8.16.3) + `drizzle-orm/node-postgres`; Drizzle+postgres-js over Hyperdrive is documented as unsupported. Request-scoped db via AsyncLocalStorage behind the existing `db` export; type the seam as `PgDatabase` so pglite and node-postgres both fit. Interactive transactions and `FOR UPDATE` are plain SQL inside a pinned connection and should work, but the docs never name `FOR UPDATE`: test it. **Hyperdrive query caching is on by default (60 s) and is not invalidated by writes: create the config with caching disabled.** drizzle-kit: direct/non-pooled URL. |
| 3   | D1                 | Stay on Postgres. Drizzle's D1 `transaction()` emits raw `begin/commit` as separate statements and D1 only documents `batch()` as transactional. delete/archive are batchable; publish is not without a rewrite.                                                                                                                                                                                                                                                                                                                                                                          |
| 4   | Vinext             | Server Actions supported. Thrown errors are redacted in production (digest + React error #441), so keep the `Result` return. `updateTag` (action-only), `revalidateTag`, `revalidatePath`, `unstable_cache` exist and map onto the Response Store; `updateTag` = hard purge = read-your-writes. `unstable_cache` still JSON-serialises: keep `revive-cache-dates`. `"use cache"` only under `cacheComponents` (incomplete): stay on `unstable_cache`. `next/image` is already wired to the Images binding.                                                                                |
| 5   | better-auth        | **The handoff's `account.issuer` migration is obsolete**: 1.7.3+ removed the requirement (installed target is 1.7.x, source is 1.7.14). The old schema has `issuer NOT NULL` + a unique index; that must be _removed_, not backfilled. Build `auth` per request over the request-scoped db. Keep the `getUserInfo` gate.                                                                                                                                                                                                                                                                  |
| 6   | zbsearch           | No Workers-native path for the client-side artifact design. "ZBSearch Edge" is a beta server-side search API (R2 + Durable Objects), a different architecture. Building + `persist(db, "seqproto")` inside a Queue consumer/Cron is plausible on Paid limits (CPU 30 s default, 5 min max; 128 MB memory is the real risk), but unmeasured. Serve from R2 custom domain, content-hashed, `Content-Encoding: br`. Spike designed below.                                                                                                                                                    |

Top risks (full ranked list at the end): Hyperdrive caching default; Supabase direct/pooler connectivity; better-auth schema mismatch blocking all auth requests; search build memory; beta toolchain churn.

---

## 1. Env and bindings

### 1.1 How `cf/config` declares things

`cf/config` re-exports `@cloudflare/config/public` (`node_modules/cf/dist/config.mjs`). The types live in `node_modules/.pnpm/@cloudflare+config@0.28.0/node_modules/@cloudflare/config/dist/public-DsUKmT49.d.mts`. The package says it is "not yet stable enough for external use" (`package.json` description), so expect churn.

| Need                  | API                                                                | Where (d.mts)    | Converted to                                                                                                |
| --------------------- | ------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Hyperdrive            | `bindings.hyperdrive({ id, dev: { connectionString?, remote? } })` | 1386-1403        | wrangler `hyperdrive[]` with `localConnectionString` (`workers-sdk/packages/config/src/convert.ts:545-552`) |
| R2                    | `bindings.r2({ name?, jurisdiction?, dev? })`                      | 1553-1575        | `r2_buckets`                                                                                                |
| Secret                | `bindings.secret()` (name = env key)                               | 1591-1601        | `secrets.required: [...]` (`convert.ts:656-657, 851-853`)                                                   |
| Plain var             | `bindings.text("value")` / `bindings.json({...})`                  | 1653, 1848, 1910 | `vars`                                                                                                      |
| Images                | `bindings.images()` (already present)                              |                  |                                                                                                             |
| Queue / Workflow / D1 | `bindings.queue()`, `bindings.workflow()`, `bindings.d1()`         | 1764+            |                                                                                                             |
| Cron                  | `triggers: [triggers.scheduled({ schedule: "0 3 * * *" })]`        | 497-512, 917     | `triggers.crons`                                                                                            |
| Queue consumer        | `triggers.queue({ name, maxBatchSize, maxBatchTimeout, ... })`     | 455-476          |                                                                                                             |
| CPU limit             | `limits: { cpuMs: 300000 }`                                        | 965-970          | `limits.cpu_ms`                                                                                             |
| Observability         | `observability: { enabled: true }`                                 | 985              |                                                                                                             |

`defineConfig`/`defineWorker` also accept a function of `{ mode, isPreview }` (`ConfigContext`, d.mts 1124; `docs/deploying/cloudflare.mdx` in the vinext clone says functions receive `mode` and `isPreview`). Use that for per-environment `bindings.text(...)` values (e.g. deployment origin) and a separate Hyperdrive id per mode.

Sketch (not applied):

```ts
env: {
  ...responseStore.applicationWorker.env,
  ASSETS: bindings.assets(),
  IMAGES: bindings.images(),
  HYPERDRIVE: bindings.hyperdrive({ id: "<id>" }),   // dev connection string comes from env var, see 1.6
  MEDIA: bindings.r2({ name: "jknm-media" }),
  SEARCH_QUEUE: bindings.queue({ /* ... */ }),
  BETTER_AUTH_SECRET: bindings.secret(),
  GOOGLE_CLIENT_ID: bindings.secret(),
  GOOGLE_CLIENT_SECRET: bindings.secret(),
  DEPLOYMENT_ORIGIN: bindings.text("https://www.jknm.si"),
},
triggers: [triggers.scheduled({ schedule: "17 3 * * *" })],
limits: { cpuMs: 300000 },
```

Cron limits: 5 triggers/account on Free, 250 Paid; CPU per cron run 30 s (interval < 1 h) or 15 min (>= 1 h) (`cloudflare-docs/.../workers/platform/limits.mdx:33,76`). Config changes can take up to 15 min to propagate (`cron-triggers.mdx:87`). Local test: `GET /cdn-cgi/local/scheduled` (`scheduled.mdx` note).

**The `scheduled` (and `queue`) handler needs a custom worker entry.** `cloudflare.config.ts` currently sets `entrypoint: "vinext/server/fetch-handler"`, which only has `default.fetch`. The vinext examples delegate from `worker/index.ts` (`vinext/examples/app-router-cloudflare/worker/index.ts`, `docs/tracing.mdx:170-182`). Because multi-stage/response-store builds can expose named exports that "must remain top-level exports" (`packages/vinext/src/server/fetch-handler.ts` header), the custom entry must `export * from "vinext/server/fetch-handler"` in addition to composing `default = { fetch: handler.fetch, scheduled, queue }`. **UNVERIFIED** that this composes cleanly with the Response Store service-binding config; smoke-test first.

### 1.2 Is `process.env` populated?

Yes at our compat date. `nodejs_compat_populate_process_env` is on by default for dates >= 2025-04-01 when `nodejs_compat` is on (`cloudflare-docs/src/content/compatibility-flags/nodejs-compat-populate-process-env.md`; `docs/workers/configuration/environment-variables.mdx:155`; `nodejs/process.mdx:30`). It is populated lazily on first access of `process`, from **text, JSON and secret bindings** and version-metadata. Hyperdrive/R2/Images are not in `process.env`. JSON values that are not strings appear as raw JSON strings. `process.env.NODE_ENV` is statically replaced at build, not a runtime value (`process.mdx:25`).

Dev vs production:

- Production: as above.
- `vp dev`: the Cloudflare Vite plugin runs the Worker in workerd, so the same flag applies. But local values are resolved by `resolveLocalBindings` (`workers-sdk/packages/miniflare/src/config/local-bindings.ts:34-72`; installed copy `node_modules/@cloudflare/vite-plugin/dist/index.mjs:89402-89440`): it iterates **only configured bindings**. A `bindings.secret()` becomes a `text` binding with the value from `.dev.vars.<mode>`, `.dev.vars`, `.env.<mode>.local`, `.env.local`, `.env.<mode>`, `.env` (warning text in `local-bindings.ts:74-80`); if a `.dev.vars` exists it is used exclusively (`devVars ?? localEnv`). Keys in `.env.local` that have no declared binding (e.g. `AWS_*`, `ALGOLIA_*`, `DATABASE_URL`) never reach the Worker. `.env.local` currently has `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `NEXT_PUBLIC_DEPLOYMENT_ORIGIN`, `JKNM_WORKSPACE_ID`, `JKNM_SERVICE_ACCOUNT_CREDENTIALS`, `RESEND_API_KEY`, `REVALIDATE_SECRET`, `VERCEL_OIDC_TOKEN`, AWS/Algolia keys (names only).
- vinext separately runs its own `loadDotenv` into the **Node** `process.env` of the Vite host (`vinext/dist/config/dotenv.js`, precedence: process.env > `.env.<mode>.local` > `.env.local` > `.env.<mode>` > `.env`). That is a different object from workerd's `process.env`; it only feeds the `NEXT_PUBLIC_*` defines (1.4) and Node-side tooling.

I did not run `vp dev`, so "populated in dev" is inferred from the plugin source; add it to the first smoke test (`/api/hello` returning `Object.keys(process.env)` minus values).

### 1.3 `import { env } from "cloudflare:workers"` in Vinext

- Vinext docs: "Import `env` from `cloudflare:workers` in Server Components, Route Handlers, and Server Actions" (`vinext/docs/deploying/cloudflare.mdx`, "Use Workers bindings").
- Module scope: allowed for reading vars and secrets, but "Workers do not allow I/O from outside a request context", so any binding _method_ (R2 `get`, KV, queue `send`, a DB socket) cannot run at top level (`workers/runtime-apis/bindings/index.mdx:159-205`). Secrets doc shows `postgres(env.DB_CONNECTION_STRING)` at module scope (`secrets.mdx:41-60`) but Hyperdrive's own docs say never create clients at module scope (`hyperdrive/concepts/connection-lifecycle.mdx:73-110`).
- Tooling consequence: `cloudflare:workers` does not exist in Node. Anything imported by `drizzle.config.ts`, scripts or `vp test` (pglite) must not import it. Put all `cloudflare:workers` access behind one tiny module (`lib/cf-env.ts`) and keep business code taking `db`/config as parameters (see 2.3).
- Types come from the generated `.cloudflare/types` (already in `tsconfig.json` include); `InferEnv` is available from `cf/config` (d.mts 351-...).

### 1.4 `NEXT_PUBLIC_*` in Vinext

Build-time inlining only. `getNextPublicEnvDefines()` copies every `NEXT_PUBLIC_*` key of the build process's `process.env` into Vite `define` as `process.env.NEXT_PUBLIC_X` (installed `vinext/dist/index.js:4507-4512`; source `index.ts:9294-9305`), after loading `.env*` files (`index.js:207, 1444`). So:

- they must exist in the environment of `vp build` / CI, not as Worker vars;
- reference them as literal `process.env.NEXT_PUBLIC_X` (no destructuring/dynamic keys), same as Next;
- `next.config.ts` `env` is also defined (`index.ts:3086-3092`).
  Whether the define also applies to the server (RSC/SSR) environments follows from Vite `define` being global; **UNVERIFIED** in a built bundle.

Good candidates for non-secret per-environment origin values: either `NEXT_PUBLIC_DEPLOYMENT_ORIGIN` (client needs it) or a `bindings.text` for server-only.

### 1.5 Env validation recommendation

`@t3-oss/env-core` is not installed and its docs are not local, so API details below are from memory (**UNVERIFIED**): `createEnv({ server, client, clientPrefix: "NEXT_PUBLIC_", runtimeEnv, emptyStringAsUndefined, skipValidation })`.

Recommendation: split by lifetime.

1. `lib/env.client.ts`: zod parse of literal `process.env.NEXT_PUBLIC_*` reads (inlined at build). Importable anywhere.
2. `lib/env.server.ts`: `getServerEnv()` memoised per isolate (env is immutable per isolate), reading `import { env } from "cloudflare:workers"` and zod-parsing secrets/vars _lazily inside the function_. Never validate at import time: that breaks Node tests, drizzle-kit and any build-time module evaluation.
3. If you want env-core's client/server leak guard, use it with the lazy-factory shape and `runtimeEnv` = merged `{...process.env, ...cfEnv}`. Otherwise plain zod is smaller and has no `window`-sniffing behavior.
   Drop `REVALIDATE_SECRET`, AWS, Algolia, `VERCEL_OIDC_TOKEN` from the schema (handoff DROP list).

### 1.6 Secrets: local and deploy; local Hyperdrive

- Local: put values in `.env.local` (or `.dev.vars`; do not use both) for every key declared with `bindings.secret()`. Missing declared secrets produce a warning, not an error. Note `.env.local` is also what vinext loads into Node.
- Deploy: `cf deploy --secrets-file <json|.env>` uploads secrets with the version (`cf deploy --help`); `cf workers secrets update <name>` and `cf workers secrets bulk --secrets @file.json` (JSON-merge-patch, one version) exist (`cf cli search "set worker secret"`). Wrangler semantics from the docs: up to 100 secrets per bulk request, omitted secrets are preserved (`workers/configuration/secrets.mdx:120-130`). `secrets.required` makes `wrangler deploy` fail if a required secret is absent (`secrets.mdx:80`); whether `cf deploy` enforces it is **UNVERIFIED**. The repo's `deploy` script is `vinext-cloudflare deploy`, which wraps `cf`; secrets-file passthrough **UNVERIFIED**.
- Local Hyperdrive: either `dev: { connectionString }` on the binding or the env var `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>` (env var wins; `local-bindings.ts:49-51`, `hyperdrive/configuration/local-development.mdx`). With the cf-config path **it throws if neither exists** ("must define dev.connectionString for local development", `local-bindings.ts:52-56`), so a fresh clone cannot `vp dev` without it. Put `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=...` in `.env.local` (the plugin copies `CLOUDFLARE_*` keys to `process.env` and reads them from `.env` files: `vite-plugin/dist/index.mjs:84929-84931`). The suffix must equal the binding name exactly. In local mode the Worker talks to the database directly: **no pooling and no query caching**, so Hyperdrive behavior (caching, pinned connections) is not exercised by `vp dev`. `dev: { remote: true }` exists for testing against the deployed config; it hits real data.

---

## 2. Drizzle + Postgres on Workers

### 2.1 Driver

- Hyperdrive docs: node-postgres (`pg`) is the recommended driver; **minimum `pg` 8.16.3** (`partials/hyperdrive/use-node-postgres-to-make-query.mdx`, `node-postgres-recommendation.mdx`).
- "Pairing Drizzle ORM with the Postgres.js driver over Hyperdrive is not currently supported" (`hyperdrive/examples/.../drizzle-orm.mdx`, caution box, `reviewed: 2026-10-01`). The old repo uses `postgres` + `drizzle-orm/postgres-js` (`.references/jknm/src/server/db/index.ts`), so switch to `pg` + `drizzle-orm/node-postgres`.
- `nodejs_compat` is required (already set). Drizzle's `pg` peer is `>=8`; `@types/pg` for types.
- Version caveat: the old repo pins `drizzle-orm ^0.45.2` and `drizzle-kit ^0.31.10`. Current Drizzle docs and examples target `drizzle-orm@rc` (v1; `drizzle-orm-docs/.../pg/connect-supabase.mdx` installs `drizzle-orm@rc`; `upgrade-v1.mdx`, `relations-v1-v2.mdx` exist). Port on 0.45.x (the clone is 0.45.4); the RQB `tx.query.X.findFirst({ with })` API used all over lifecycle/new-article is the v1-relations API. Treat v1 as a separate later upgrade.
- Result-shape differences between drivers: `db.execute()` returns a `{ rows }` object with node-postgres vs an array with postgres-js. `src/` has no `.execute(` calls (only scripts), so no change needed in app code.
- Old code passes `prepare: false` for Supavisor transaction mode. With `pg` there is no equivalent switch; Drizzle only uses named statements when you call `.prepare("name")`. Hyperdrive supports named prepared statements from `pg` (`partials/hyperdrive/pooling-mode.mdx`).

### 2.2 Per-request client pattern

Docs pattern: `new Client({ connectionString: env.HYPERDRIVE.connectionString })`, `await client.connect()`, `drizzle(client)` per request; no need to `end()`; do not use `new Pool()` in global scope (`connection-lifecycle.mdx`, `troubleshooting.mdx:105`). Constraint: 6 simultaneous outgoing connections per invocation (`workers/platform/limits.mdx:27, 215-228`).

Two options for the per-request instance:

- **Client** (documented): must be connected before use. One socket, queries serialise. Drizzle's `db.transaction` on a non-Pool client runs `begin`/`commit` on that same client (`drizzle-orm/src/node-postgres/session.ts:248-268`, `isPool ? ... : this`). Hazard: any query issued on the same client concurrently with an open transaction (e.g. `Promise.all` with the outer `db` instead of `tx`) executes _inside_ that transaction. The existing code uses `tx` inside callbacks, so this is manageable but worth a lint/review rule.
- **Pool created per request, `max` <= 5** (not in the Hyperdrive docs; the docs only forbid global pools): lazy connect, Drizzle takes a dedicated client per transaction (`session.ts:252-254`) and releases it. Better fit for the `Promise.all`-heavy read paths. **UNVERIFIED** against Hyperdrive; include in the spike.

Why a lazy wrapper matters: you cannot `await client.connect()` inside a synchronous `import { db }` access. I could not verify whether `pg` queues queries issued before `connect()` (**UNVERIFIED**, no `pg` source local), so do not rely on it. A per-request `Pool` sidesteps this because `drizzle(pool)` connects on first query.

### 2.3 Seam: keep `import { db }`, make it request-scoped

Old shape: 21 files import `db` from `~/server/db`; two functions take `db_conn: typeof db = db`; five tests build pglite via `create_test_db()` and cast `as unknown as typeof real_db` (`server/db/test-helpers.ts`).

Proposed seam (new `server/db/index.ts`):

```ts
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>; // satisfied by NodePgDatabase and PgliteDatabase
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const als = new AsyncLocalStorage<{ db: Db }>(); // node:async_hooks, available under nodejs_compat
export const runWithDb = <T>(db: Db, fn: () => T) => als.run({ db }, fn);
export const getDb = (): Db => {
  const s = als.getStore();
  if (!s) throw new Error("no request db");
  return s.db;
};
export const db: Db = new Proxy({} as Db, { get: (_, p) => Reflect.get(getDb(), p) }); // call sites unchanged
```

- Production: the custom worker entry (needed anyway for `scheduled`/`queue`, 1.1) wraps every handler: `fetch`, `scheduled`, `queue` do `runWithDb(createPgDb(env.HYPERDRIVE.connectionString), () => handler.fetch(...))`. `createPgDb` is the only file importing `pg`/`cloudflare:workers`. ALS also covers Route Handlers and Server Actions, which React `cache()` does not reliably (the old `auth/index.ts` comment says as much).
- Tests: `runWithDb(pgliteDb, () => ...)` in a vitest `beforeEach`, or pass `pgliteDb` to functions that already accept `db_conn`. Typing against `PgDatabase` removes the `as unknown as typeof real_db` cast. `PgliteDatabase` and `NodePgDatabase` both extend `PgDatabase` (`drizzle-orm/src/node-postgres/driver.ts:43`).
- The Proxy hides that `db.transaction`, `db.query`, `db.select` bind `this`; `Reflect.get` returns unbound methods, so bind: `typeof v === "function" ? v.bind(target) : v`. Easy to forget.
- Alternative with less magic: make `getDb()` explicit and thread it; more churn (21 files) but no Proxy. I would take the Proxy now and refactor only hot spots.
- better-auth takes a db at construction, see 5.2.

### 2.4 Interactive transactions and `SELECT ... FOR UPDATE` through Hyperdrive

What the docs say: the pooler is in **transaction mode**; "the client that executes the query communicates through a single connection for the duration of a transaction"; `BEGIN/COMMIT` with `SET` inside works (`partials/hyperdrive/pooling-mode.mdx`). Keep transactions short because each holds an origin connection (`connection-lifecycle.mdx` "Long-running transactions"). Per-config origin connections: ~20 Free, ~100 Paid (`platform/limits.mdx:30`); max statement duration 60 s; initial connect timeout 15 s.

Verdict: `db.transaction(async tx => ...)` (including awaits between statements and `tx.transaction` savepoints) and `.for("update")` are ordinary SQL on one pinned origin connection, so they should work; row locks live until `COMMIT`. The docs do not mention row locks or `FOR UPDATE` explicitly, so mark **UNVERIFIED** and test: two concurrent `publish_article` calls superseding the same source must serialise (the second must see `status: "deleted"` and fail `assert_can_supersede`, the scenario in `new-article.ts:67-76`).

Not supported (`reference/supported-databases-and-features.mdx`): advisory locks, `LISTEN/NOTIFY`, SQL-level `PREPARE/DEALLOCATE/DISCARD`, session state changes. `grep` found no use of these in `src/`.

The lifecycle transactions are short (a handful of statements, no network I/O inside: the Algolia calls were already moved out). When rewriting search sync, keep the R2/queue calls **outside** the transaction.

### 2.5 Hyperdrive query caching (important)

Query caching is **enabled by default**, `max_age` 60 s and `stale_while_revalidate` 15 s, and "Hyperdrive does not purge or invalidate cached read query results when your application writes" (`hyperdrive/concepts/query-caching.mdx:108-124`). Docs name authentication, sessions, permissions and reads right after a write as cases that need a cache-disabled configuration (`:132`), and say that if a library owns the SQL (better-auth, drizzle) it should get a cache-disabled client (`:135`).

Consequences here: after `updateTag("article")` the next render could still read the pre-publish row from Hyperdrive's cache, defeating the whole point of the Vinext cache invalidation path and ADR-0005's read-your-writes argument; better-auth session lookups could be stale for up to 60-75 s. Verdict: **create the production Hyperdrive config with caching disabled** (docs: `--caching-disabled` on wrangler; the `cf hyperdrive create` flag name is **UNVERIFIED**, check `cf hyperdrive create --help` / `cf schema hyperdrive create`). The Vinext Response Store is the cache layer; Hyperdrive is only the pooler. Local `vp dev` bypasses Hyperdrive so this bug only shows up deployed: add a deployed-preview test (publish, then read).

### 2.6 drizzle-kit

Connect directly with a plain URL: `dialect: "postgresql"`, `dbCredentials.url` (`drizzle-orm-docs`, Hyperdrive Drizzle example step 2.3: "Replace with your direct database connection string"). drizzle-kit runs in Node on your machine, not in the Worker; Hyperdrive is irrelevant. The existing `drizzle.config.ts` already does `DATABASE_URL.replace(":6543", ":5432")`, i.e. the current runtime URL is the Supabase **transaction pooler on 6543**. The repo has no migrations directory (only `drizzle.config.ts`), so the project uses `drizzle-kit push`; keep that for Postgres.

### 2.7 Supabase pooler vs direct for Hyperdrive

Hyperdrive docs for Supabase: "use the **Direct connection** connection string rather than the pooled connection strings. Hyperdrive will perform pooling" (`hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase.mdx`). So do **not** point Hyperdrive at the 6543 URL currently in `.env.local` (double transaction pooling; Supavisor's transaction mode also forbids session state). Use port 5432.
**UNVERIFIED (Supabase docs not local):** Supabase's direct host (`db.<ref>.supabase.co`) is IPv6-only unless the IPv4 add-on is bought; the Supabase _session-mode_ pooler on 5432 is IPv4. Hyperdrive IPv6 reachability is implied by the Fly example ("Cloudflare recommends using IPv6", `fly.mdx:34`) but not stated for Supabase. If direct fails from Hyperdrive, fallback is the session pooler string (5432) which is still not transaction mode. Also note the user's dev machine may need IPv6 for drizzle-kit against the direct host; the session pooler works there.

---

## 3. D1 side-report

### 3.1 Does Drizzle's D1 driver do transactions?

`drizzle-orm/src/d1/session.ts:111-126` implements `transaction()` by running `begin [behavior]`, your callback, then `commit`/`rollback` as **separate `D1Database` statements** (`this.run(sql.raw('begin ...'))`), and savepoints for nesting (`:134-140`). D1 itself documents only `batch()` as transactional: "D1 operates in auto-commit... batched statements are SQL transactions" (`cloudflare-docs/.../d1/worker-api/d1-database.mdx:97-99`). I found no D1 doc that says `BEGIN` over the binding works, and no Drizzle doc/caveat either. The Drizzle D1 integration test runs against a miniflare in-memory shim (`integration-tests/tests/sqlite/d1.test.ts:19-24`), which proves nothing about real D1. Real D1 behavior is **UNVERIFIED**; my recollection is that interactive `BEGIN` errors on the D1 binding and Drizzle users are told to use `db.batch()`. Treat interactive `db.transaction` as unavailable on D1.

### 3.2 What could be one D1 batch

| Transaction                     | File                                     | Shape                                                                                                                                                                                                                                                                                                            | Batchable?                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| delete                          | `lifecycle.ts:176-210`                   | 2 reads (`find_lifecycle_target`), assert, 1-2 `UPDATE ... RETURNING`                                                                                                                                                                                                                                            | Yes: read first, then one batch of guarded updates (`WHERE id=? AND status IN (...)`). Race window between read and batch instead of a lock.                                                                                                                                                                                                                                                                            |
| unpublish (= `archive_article`) | `lifecycle.ts:131-170`                   | same shape + cascade soft-delete of a draft                                                                                                                                                                                                                                                                      | Yes, same pattern. (Search unlist moves out of the transaction anyway.)                                                                                                                                                                                                                                                                                                                                                 |
| publish                         | `new-article.ts` publish (~line 420-520) | reads, `decide_published_at`, `resolve_thumbnail`, update, `replace_article_authors`, `reconcile_media_to_articles` (diff against current links), slug decision, **app-level suffix probe loop** (`slug.ts:28-63`), `FOR UPDATE` on the superseded row, legacy_id hand-off (null first, then set), final re-read | Not mechanically. Every write depends on a prior read. You'd restructure to "read, compute a plan in pure JS, execute one batch of guarded statements", with unique indexes (slug, `legacy_id`) as the arbiter and an app-level retry on constraint failure. `FOR UPDATE` has no SQLite equivalent (writes are serialised per DB instead). A batch cannot abort on "0 rows updated"; only a constraint error aborts it. |

Also: D1 limits are 100 bound parameters per query, 1000 queries per invocation (a batch counts as one), 2 MB per string/blob row, 30 s statement (`d1/platform/limits.mdx`).

### 3.3 Schema in SQLite

| Postgres (`server/db/schema.ts`)                                    | SQLite/D1                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pgEnum` author_type, article_status, article_kind                  | `text("...", { enum: [...] })`, plus a hand-written `CHECK` (Drizzle's sqlite `enum` is type-only)   |
| `uuid("id")` (+ `gen_random_uuid`/`$defaultFn`)                     | `text` with `$defaultFn(() => crypto.randomUUID())`                                                  |
| `jsonb` `content_json`, `original`, `variants`, `srcsets`           | `text("...", { mode: "json" })`                                                                      |
| `timestamp(..., { withTimezone })`                                  | `integer("...", { mode: "timestamp_ms" })`                                                           |
| `varchar`, `boolean`                                                | `text`, `integer({ mode: "boolean" })`                                                               |
| `${Media.original}->>'url'` (raw SQL in `reconcile-media.ts:56-57`) | `json_extract(original,'$.url')` or `->>` on text JSON; rewrite by hand                              |
| `.for("update")`                                                    | remove                                                                                               |
| `inArray(...)` with large lists / bulk inserts                      | chunk to stay under 100 params                                                                       |
| better-auth tables                                                  | Drizzle adapter works with SQLite, or Kysely D1 dialect (better-auth `concepts/database.mdx:67-124`) |

### 3.4 Data migration

Freeze writes; dump each table from Postgres via Drizzle (697 published articles plus drafts, authors, slugs, media links: small); transform timestamps to ms integers, JSON to strings, uuids as-is; insert in batches under the 100-param limit via a one-off Worker/script or `cf d1` import; verify row counts and per-table hashes; point the app at D1; keep Postgres read-only for a rollback window. D1 offers Time Travel (30 days Paid) instead of Supabase backups (`d1/platform/limits.mdx` table). Re-point `drizzle-kit` to `dialect: "sqlite"` with generated migrations (the project currently uses `push`). Rewrite pglite tests to run against sqlite (better-sqlite3/libsql in-memory) or `@cloudflare/vitest-pool-workers`, and re-validate every JSON query.

### 3.5 Recommendation

**Stay on Postgres/Hyperdrive.** Reasons: the interactive-transaction story on D1 is undocumented, publish needs a rewrite and loses its lock, the pglite test investment and `->>` queries all need redoing, and the handoff already decided it. D1 is attractive only for removing the Supabase dependency and pause risk.
What would change this: (a) the spike shows Hyperdrive cannot hold `FOR UPDATE`/transactions or cannot reach Supabase; (b) Supabase cost or pausing becomes the main pain; (c) real D1 tests show `db.transaction` works (cheap to check: one 20-line Worker); (d) the user wants to drop an external vendor and accepts rewriting `publish_article` as a read-plan-then-batch design.

---

## 4. Vinext behavior

### 4.1 Server Actions and error redaction

- Supported: `docs/reference/differences.mdx` "Compatibility": "App Router, Pages Router, RSC, Server Actions, middleware, Route Handlers, static generation, ISR... are implemented". `serverActions.bodySizeLimit` is enforced (`vinext/src/check.ts:368`; old repo sets 100mb, which equals the Free/Pro request-body cap on Workers: `workers/platform/limits.mdx:52-60`, based on the zone plan). Prefer presigned/direct R2 uploads over 100 MB action bodies.
- Redaction: thrown errors are routed through the RSC `onError`, which returns a digest (`dist/server/app-rsc-errors.js:64-92`), and in production the client sees "Minified React error #441" with a `digest` (`:43-62`). The server logs the real error with `console.error("[vinext] Server action error:", ...)` (`app-server-action-execution.js:497-511, 520-535`); a non-Flight failure returns a 500 with **no body** in production (`:535, 659`). Navigation signals (`redirect`, `notFound`) pass through via `getDigestForWellKnownError`. **Verdict: same as Next, so the `Result` return type is required** for user-facing messages (Slovenian validation/permission errors); throw only for programmer errors and redirects.

### 4.2 Cache APIs and mapping onto the Response Store

Installed `vinext/dist/shims/cache.js`:

| API                                                  | Exists                                                   | Behavior                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unstable_cache(fn, keyParts, { tags, revalidate })` | yes (`:431-472`)                                         | Key = SHA-256 of `fn.toString()` + keyParts + `JSON.stringify(args)`. Result stored as a FETCH-kind entry in the **data cache**. Serialised with `JSON.stringify` (`:337-343`): **Dates become strings on hits**. Bypassed in draft mode. |
| `revalidateTag(tag, profile?)`                       | yes (`:59-85`)                                           | No profile or `expire: 0` -> hard purge; `"max"`/profile -> stale-while-revalidate invalidation.                                                                                                                                          |
| `updateTag(tag)`                                     | yes (`:147-153`)                                         | **Throws unless `getHeadersAccessPhase() === "action"`**, i.e. only inside a Server Action, same as Next. Hard invalidation (read-your-writes).                                                                                           |
| `revalidatePath(path, type?)`                        | yes (`:110-129`)                                         | Becomes the tag `_N_T_<path>[/page                                                                                                                                                                                                        | /layout]`; skips edge purge when every route serving the path is `force-dynamic`. |
| `refresh()`                                          | yes (`:131`)                                             | Reports dynamic-only invalidation to the client router.                                                                                                                                                                                   |
| `"use cache"` / `cacheLife` / `cacheTag`             | compiler plugin exists (`plugins/use-cache-callable.ts`) | Only meaningful with `cacheComponents: true`; docs: "Cache Components and Partial Prerendering remain incomplete" (`differences.mdx` "Compatibility").                                                                                    |

How the Response Store handles it (`@vinext/cloudflare/dist/cache/response-store-data.runtime.js:328-335`): `revalidateTag(tags, durations)` calls `store.invalidate({tags, expire})` when it is a stale-style invalidation, otherwise `store.purge({tags})`. `updateTag` and the old `revalidateTag(tag)` therefore **purge**: the next reader misses and regenerates synchronously, which is exactly the read-your-writes behavior that `apply_server_invalidations` relies on (its doc comment in `.references/jknm/src/server/cache-invalidation.ts`). The CDN (Workers Cache) layer purge is queued and sent **once per cacheLife profile at the end of the Server Action/Route Handler** (`cache.js:87-91`; `docs/caching.mdx` "Workers Cache and KV"). Response Store services: Workers Cache for hot responses, R2 for bodies, a SQLite Durable Object for tags/revisions (`workers-response-store/README.md`). Service-binding mode (current setup) puts the DO and R2 in the separate `jknm-cloudflare-response-store` Worker, which must be deployed first (`package.json` script `deploy:response-store`).

Works inside a Server Action: yes, that is the only place `updateTag` is allowed; invalidation of the data cache is immediate for reads later in the same action (`cache.js:80-92` comment).

Outside actions (Cron sweep, Queue consumer): `revalidateTag` schedules via `getRequestExecutionContext()`/`waitUntil`; whether that has a valid context in `scheduled`/`queue` handlers is **UNVERIFIED**. The sweep only deletes already-hidden content, so it probably needs no public invalidation; the search rebuild writes straight to R2, not through the Vinext cache.

What the old repo needs from the cache:

- `lib/cache-policy.ts`: pure event -> `{tags, paths}`; adapters `apply_server_invalidations` (`updateTag` + `revalidatePath`) and the Route Handler adapter (`revalidateTag(tag,"max")`). Both APIs exist; the first works unchanged. Drop `apply_route_invalidations` and the internal revalidate route (handoff DROP list). The reachability test stays valid. `CACHE_PATHS = ["/", "/sitemap.xml"]`: vinext purges for metadata routes (`caching.mdx` on `revalidatePath` skipping purge "when a metadata route could serve the path" implies it does not skip).
- ADR-0005 (stay on `unstable_cache`, keep `revive-cache-dates`): still correct on Vinext. `use cache` is not an option under incomplete Cache Components; `unstable_cache` JSON-serialises exactly like Next (`cache.js:337`), so `revive_cache_dates` remains load-bearing.
- ADR-0006 (no ISR on `/novica/[slug]`): the blocker was `headers()` via the session read making the route dynamic. Vinext decides dynamism the same way ("Dynamic APIs include `cookies()`, `headers()`...", `caching.mdx` "Which App Router pages are cached"; `differences.mdx` Caching: "a route that reads `cookies()` or `headers()` ... is dynamic"). Conclusion unchanged. Nuance: Vinext learns dynamism _while rendering_; add `export const dynamic = "force-dynamic"` on session-reading layouts so those routes skip the cache lookup and the edge purge budget (`differences.mdx`, `caching.mdx`).
- Smoke test required by the handoff: one action calling `updateTag("article")`, a page with `unstable_cache({tags:["article"]})`, verify (a) hit, (b) miss after action, on a deployed preview, with Hyperdrive caching disabled.

### 4.3 Images binding, `next/image`

`vite.config.ts` already has `vinext({ images: { optimizer: imagesOptimizer() } })`, and `cloudflare.config.ts` has `IMAGES: bindings.images()`. That wires `next/image`'s `/_next/image` endpoint to `env.IMAGES.input(body).transform({ width }).output({ format, quality })` (`@vinext/cloudflare/dist/images/images-optimizer.runtime.js`). So `next/image` stays; no replacement needed. Standard `images.remotePatterns` etc. are read from `next.config` (`vinext/src/image/image-adapters-virtual.ts:45`); add the media origin (`gradivo.jknm.org`) there. The old `images: { unoptimized: true }` and the dead variant/srcset pipeline can go.
Direct use: `env.IMAGES.input(r2Object.body).transform(...).output(...)` in a Route Handler. Input up to 20 MB; calls are billed per _unique_ transformation per month (5,000 included/free, then $0.50/1,000: `images/pricing.mdx:24-57`); the docs "strongly recommend" Workers Cache in front because the binding re-encodes on every call (`images/optimization/binding.mdx`, "Enable caching"). Whether `/_next/image` responses are stored by the Response Store is **UNVERIFIED**; check `cf-cache-status` on a preview. Pre-generated variants in R2 are the zero-risk alternative if the bill matters.

### 4.4 Route handlers, metadata routes, redirects

- Route Handlers supported (`differences.mdx`). `app/si/route.ts`, `app/si/[...path]/route.ts`, `api/auth/[...all]/route.ts` carry over; `NextResponse.redirect(url, 301)` and `permanentRedirect` are shimmed. `/api/wake_supabase` and `vercel.json` cron: drop or Cron Trigger (handoff).
- Metadata routes: `sitemap.ts`, `robots.ts`, `manifest.ts`, static `opengraph-image.png`, `icon` files are supported (`vinext/src/server/metadata-routes.ts` header comment lists them; dynamic ones export a default function). Sitemap is DB-backed -> goes through `db`, so run it inside the request-scoped db and make it dynamic or tag-cached.
- `redirects`/`rewrites`/`headers` in `next.config` are supported, including **external rewrites** that are proxied (`src/server/app-middleware.ts:200-224`, `config-matchers.js` `proxyExternalRequest`). The old `/media/*` and `/img/*` rewrites to B2 (`next.config.ts`) would now proxy through the Worker on every hit; better to serve them from an R2 custom domain/Cloudflare redirect rule and keep URLs unchanged. The `.vercel.app` noindex header rule becomes `.workers.dev` (or preview hostname). Regex sources are not backtracking-checked (`differences.mdx` "Routing config").
- Static public files: `runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"]` (already set) means every non-build request invokes the Worker (`deploying/cloudflare.mdx` "Middleware and static files"). Don't switch to `runWorkerFirst: true`; it 404s the build output.
- Run `vinext check` against `.references/jknm` to get the tool's own incompatibility list (`check.ts` knows `revalidateTag, revalidatePath, updateTag, refresh, unstable_cache...`, line 105). Not run.

---

## 5. better-auth on Workers

Source: `~/code/repos/better-auth/better-auth` (packages/better-auth 1.7.14). Old repo pins 1.7.1, installed target to be chosen (>= 1.7.3).

### 5.1 `account.issuer`: the handoff is out of date

- 1.7.0-1.7.2 added a required `issuer` column + unique index `account_issuer_accountId_uidx`. **1.7.3 reversed it**: "Version 1.7.3 restores the account schema used before 1.7, identifying accounts by `providerId` + `accountId`" (`docs/content/blogs/1-7-account-schema.mdx`). The 1.7 upgrade guide: "The account schema is unchanged from 1.6. No column needs to be added" (`docs/content/docs/guides/1-7-upgrade-guide.mdx:80-84`).
- The old repo's Drizzle schema has `issuer: varchar(...).notNull()` and a unique index `account_issuer_account_id_uidx (issuer, account_id)` (`.references/jknm/src/server/db/schema.ts:97, 119-122`), and `scripts/migrate/backfill-account-issuer.ts` fills it. On >= 1.7.3 new rows no longer write `issuer`; a `NOT NULL` column "rejects every sign-up and account link" (guide `:87`), and schema validation at init compares the Drizzle schema object (it "reports ... required columns it never fills") and **fails authentication requests** on mismatch (`docs/content/docs/concepts/database.mdx:128-130`).
- Required work, in order: (1) **remove `issuer` and its index from the new repo's Drizzle schema** (don't port them); (2) check production: `SELECT * FROM account LIMIT 0;` (guide `:94-99`). If the column is absent, nothing to do; if present (the old repo ran the backfill path), run `ALTER TABLE account ALTER COLUMN issuer DROP NOT NULL; DROP INDEX <index name>;` and optionally drop the column later; the index name in _our_ DB is `account_issuer_account_id_uidx` (Drizzle's name), not the docs' `account_issuer_accountId_uidx`. (3) Run the duplicate check `SELECT "providerId","accountId",count(*) FROM account GROUP BY 1,2 HAVING count(*)>1` (adjust to snake_case: `provider_id, account_id`). (4) Pause auth writes during cutover, restart all instances (blog "How do I clean up..."). Production DB state is unknown to me (**UNVERIFIED**, not queried). The `backfill-account-issuer.ts` script should **not** be kept.

### 5.2 Constructing auth when env/DB arrive per request

`database` is a static option (`packages/core/src/types/init-options.ts:621-660`: pool, dialect, `DBAdapterInstance`, `D1Database`...); `drizzleAdapter(db, ...)` captures `db` at construction. No built-in per-request db hook. Options:

1. `getAuth()` factory called per request, memoised in the same ALS store as the db (2.3): `betterAuth({ database: drizzleAdapter(getDb(), {...}), secret, ... })`. Cost of constructing per request is unmeasured (schema validation is cached "per adapter instance", `database.mdx:130`, so a new adapter re-validates against the local Drizzle object; no DB query for Drizzle). Measure in the spike; if heavy, use option 2.
2. Construct once per isolate with `drizzleAdapter(dbProxy, ...)` where `dbProxy` is the ALS-backed Proxy from 2.3. One `betterAuth()` per isolate, queries resolve the request's db lazily. This keeps `import { auth }` call sites. Needs the Proxy to be a valid drizzle db for the adapter's property access (`query`, `select`, `insert`, `transaction`); untested.
   Either way: secret/client id/secret come from `cloudflare:workers` env inside the factory (1.3), not module scope in code that Node tools import.

Route handler: `export const GET = (req) => getAuth().handler(req)` (and POST) instead of `toNextJsHandler(auth)` at module scope. Installation docs show `auth.handler(request)` for Workers (`docs/content/docs/installation.mdx:329-346`). Better-auth needs `AsyncLocalStorage`, which `nodejs_compat` provides (`installation.mdx:349`, `integrations/hono.mdx:61`).

Background work: `advanced.backgroundTasks.handler`; better-auth's docs say use `waitUntil` from `cloudflare:workers` (`docs/content/docs/reference/options.mdx:712`). I did not find that export in the Cloudflare docs I have (**UNVERIFIED**); vinext exposes its own request execution context. Default (no handler) is fine to start; the option introduces eventual consistency (`options.mdx:714-716`).

### 5.3 Google provider and the `@jknm.si` gate

- `getUserInfo` override still exists and replaces the built-in callback-path `hd` check; the docs say to validate the claim yourself (`docs/content/docs/authentication/google.mdx:165-171`; `packages/core/src/social-providers/google.ts` `getUserInfo`: `options.getUserInfo` wins). The old gate (`is_allowed_sign_in` on email + `email_verified`) stays valid. It decodes the id token without signature check, as the built-in does, because the token comes from the back-channel token exchange.
- Simplification available: 1.7 added native `hd: "jknm.si"` enforcement against the verified `hd` claim (`google.ts` `isGoogleHostedDomainAllowed`, `google.mdx:151-163`). Using `hd` plus a `databaseHooks.user.create.before` would drop the custom `getUserInfo`, but the custom path is already tested; keep it, optionally add `hd` as defense in depth (it only applies when `getUserInfo` isn't overridden, so combining them needs your own check). Not necessary for the port.
- `account.accountLinking.trustedProviders: ["google"]` and `baseURL: { allowedHosts: [...] }` are still documented 1.7 features (`guides/dynamic-base-url.mdx`, upgrade guide `:598-613`: with `allowedHosts` forwarded headers are ignored unless opted in, fine since the Worker sees the real Host). Add the production hosts and the workers.dev/preview hostname to `allowedHosts`, and register the redirect URIs in Google Cloud for each.

### 5.4 Cookies and sessions on Workers

- Session is DB-backed: every `auth.api.getSession` is a query through Hyperdrive (caching must be off, 2.5). `session.cookieCache` can cut DB reads at the price of delayed revocation (`concepts/session-management.mdx:222-244`).
- Cookies are `Secure` by default in production (`options.mdx:673` `useSecureCookies`), host-only unless `crossSubDomainCookies` (`:676`). jknm.si vs www.jknm.si sessions are therefore separate; pick one canonical host at cutover (open item in the old `domain-cutover-checklist.md`).
- Rate limiting should read `cf-connecting-ip` (`concepts/rate-limit.mdx:64-69`).
- `nextCookies()` plugin is only needed if you call auth APIs that set cookies from Server Actions; the old code doesn't. `headers()` from `next/headers` is shimmed by vinext, so `getServerAuthSession` ports as is, with React `cache()` only as an optimisation.

---

## 6. zbsearch on Workers

Sources: `micheleriva/zbsearch` clone (v4.0.1) `apps/docs/content/docs/cloudflare/*` (read fully: index, setup, indexing-and-rebuilds, local-development, production, cost-calculator, benchmarks, api-reference), `packages/plugin-data-persistence`, and `gh issue view 45 --repo lukaprsina/jknm --comments` (read).

### 6.1 Does zbsearch ship a Workers-native path?

It ships **ZBSearch Edge** (beta): a self-hosted REST search API on Workers + R2 + two Durable Object classes (`IndexCoordinator` for WAL/rebuild lock, `ShardSearch` for sharded search), msgpack snapshots at `indexes/{id}/{version}/snapshot.msgpack`, WAL in R2, cron rebuilds, builder CLI over the S3 API (`index.mdx`, `indexing-and-rebuilds.mdx`). That is a _server-side search service_. It does not produce or serve the **client-side seqproto artifact** that issue #45 benchmarked, and it is a different product shape than the handoff ("built when the published set changes, then served as a static artifact"). Verdict: use zbsearch as a **library** inside our Worker; ignore Edge, but treat its numbers as evidence:

- In-Worker rebuild of a whole index is an intended mode: "In-Worker rebuild... for small indexes", Workers Paid required, `cpu_ms = 300000` (`setup.mdx`, `production.mdx` "Cloudflare plan requirements"). Measured CPU: "96k docs rebuilt in ~6s CPU", ~62 us/doc (`cost-calculator.mdx`, table "Rebuilds"). Their docs are ~1.3 KB each and unstemmed English; ours are ~3 KB plaintext (2.14 MB / 697) with Slovenian stemming, so this is a lower bound, not a prediction.
- Memory: snapshot caches default to 64 MB (`SNAPSHOT_CACHE_MAX_BYTES`), "Very large indexes will hit Worker memory limits during in-Worker rebuild", and 8 x 16.5 MB shards in one isolate OOM'd at 128 MB (`production.mdx` "Scaling guidance"). Our index is ~1.4 MB brotli / ~8 MB raw json; building holds docs + radix tree + export + serialised buffer at once.
- Edge docs are English-only (`language: "english"` examples); Slovenian comes from `@zbsearch/stemmers/slovenian` (exported in `packages/stemmers/package.json:155`), used in `zbsearch-bench.ts`.

### 6.2 Can `persist()`/seqproto run in a Worker?

`persist(db, "seqproto")` = `save(db)` (full export object) then `serializeZBSearchInstance(db)` -> `ArrayBuffer` via the `seqproto` package (`plugin-data-persistence/src/index.ts:55-83`, `seqproto.ts:326-468`). The seqproto path does not touch `Buffer`/`node:` APIs; `Buffer` is only used for `binary`/hex (`index.ts:78, 121-143`) and exists under `nodejs_compat` anyway. Brotli: `node:zlib` supports brotli under `nodejs_compat` (`workers/runtime-apis/nodejs/zlib.mdx`). So it is feasible; the unknowns are CPU/memory:

- CPU: Paid per HTTP request default 30 s, configurable to 5 min; cron 30 s (< 1 h interval) or 15 min (>= 1 h); Queue consumer default 30 s, configurable to 5 min; Workflow step 30 s -> 5 min (`workers/platform/limits.mdx:73-76`, `queues/platform/limits.mdx:30,46-60`, `workflows/reference/limits.mdx` table + `:145-153`). CPU only counts active compute, not I/O waits. Stemming + `insert` of 697 docs + brotli q11 is probably seconds, not minutes; **unmeasured**.
- Memory: 128 MB per isolate (`limits.mdx:120-126`), the actual risk. Issue #45: the `binary` (msgpack) path added **+183 MB heap** on the unstemmed Orama index while seqproto was "noise". So **never use `binary`/`json` formats in the Worker**; seqproto only, and release `save()` exports promptly.
- Slovenian stemmer module size/startup: Worker startup must finish in 1 s (`limits.mdx:31`); stemmer + stopword tables load at module scope. Lazy-`import()` the stemmer inside the rebuild handler so the main request path (`fetch`) doesn't pay startup for it, or put the rebuild consumer in a **separate Worker** (auxiliary worker, like the response store) so its bundle/startup/memory are isolated from the 'vinext' Worker.
- Packaging: `@zbsearch/plugin-data-persistence` and `@zbsearch/plugin-qps` still declare `"zbsearch": "workspace:*"` in the cloned source (`packages/plugin-*/package.json:56,45`). Whether published 4.0.1 fixes it is **UNVERIFIED**; keep the pnpm override. QPS stays unusable (persistence round-trip bug, issue #45).

### 6.3 What triggers a rebuild

Published-set changes already funnel through `cache-policy.ts` events (`article.published/archived/deleted/unarchived` + author events that change bylines). Ranked:

1. **Queue consumer (recommended).** The Server Action, after commit, does `env.SEARCH_REBUILD.send({ reason }, { delaySeconds: 30 })`. Consumer config `maxBatchSize` high, `maxBatchTimeout` up to 60 s (`queues/platform/limits.mdx:25`) collapses bursts of publishes into one invocation; `delaySeconds` max 24 h. Consumer: read published rows (Hyperdrive), compute a content hash (`max(updated_at)`, count, ids), compare with `search/manifest.json` in R2, skip if equal, else build + upload. Idempotent, so at-least-once delivery is harmless. CPU limit raised with `limits.cpuMs`. Wall clock 15 min. Retries/DLQ built in. Fits the "event-driven, no polling" goal.
2. **Cron safety net** (daily or every 15 min) running the same idempotent function; also covers missed sends and author renames done outside actions.
3. **Workflow**: only if build needs checkpointing across steps (load -> build -> persist -> compress -> upload). Step results are capped at 1 MiB (`workflows/reference/limits.mdx`), so the artifact must go to R2 _inside_ a step, not between steps. Overkill unless the spike shows one invocation can't hold it.
4. **GitHub Action + Node builder**: the zbsearch Edge docs' own recommendation for production (external builder "mandatory" past ~100k docs; `production.mdx`). Escape hatch if the spike fails on memory/CPU: runs the existing Node `zbsearch-bench`-like script, uploads to R2 via S3 API or `cf r2 object put`. Costs: secrets in CI, a relay from Worker to `repository_dispatch` (`production.mdx` "GitHub Actions setup"), minutes of latency.

### 6.4 Where to serve the artifact

- **R2 + custom domain (recommended)**: reuse the media origin `gradivo.jknm.org` (or a sibling) so there's no Worker invocation per download. Object key content-hashed (`search/<sha256>.zbs`) with `Cache-Control: public, max-age=31536000, immutable`, plus a small `search/manifest.json` (`{ hash, bytes, count, builtAt }`, `max-age=60`). R2 stores per-object `httpMetadata` including `contentEncoding` and `cacheControl` (`r2/api/workers/workers-api-reference.mdx:517`, `r2/api/s3/extensions.mdx:28`), so upload a pre-compressed brotli body with `Content-Encoding: br` and `Content-Type: application/octet-stream`; clients decode transparently with `fetch`. Caveat: a client without `Accept-Encoding: br` gets an undecodable body (all current browsers send it). CORS on the bucket must expose what the client reads (`r2/buckets/cors.mdx:136`) if www.jknm.si fetches cross-origin.
- **Static Assets**: not suitable. Assets are fixed per deployment (file cap 25 MiB, `limits.mdx:35`), and the Vinext docs say the static response cache is read-only until redeploy (`caching.mdx` "Static Assets response cache"). It would mean a deploy per publish.
- Via a Worker route reading the R2 binding (same-origin, no CORS) is fine too, but spends a Worker request per fetch and the Images/Workers Cache advice applies. **UNVERIFIED**: whether the R2 public custom-domain path applies Brotli itself for non-text types; with pre-compression it doesn't matter.
- brotli quality: q11 on several MB can cost seconds of CPU; measure q9 vs q11 in the spike (issue #45 sizes were Node default quality = 11).

### 6.5 Measuring CPU properly (and memory)

In deployed Workers `Date.now()`/`performance.now()` only advance on I/O (`workers/runtime-apis/performance.mdx:19`; `reference/security-model.mdx:22,176`), so in-Worker stopwatches read ~0 for pure compute. (Local `wrangler dev`/`vp dev` workerd does not apply the Spectre mitigation, so local timers work: **UNVERIFIED** in docs; just don't compare them with deployed numbers.) Instead:

- Workers Logs invocation logs expose `$workers.cpuTimeMs` as a queryable field (`observability/query-builder.mdx:102,116`; limits doc: "CPU time and wall time appear in the invocation log", `limits.mdx:114`). Requires `observability: { enabled: true }`.
- Tail Workers / Logpush carry CPU and wall time at the top level of the trace event (`limits.mdx:115`); GraphQL `workersInvocationsAdaptive` has `cpuTimeP50/P99` (`analytics/graphql-api/tutorials/querying-workers-metrics.mdx`; units not stated there).
- To attribute CPU to phases, run each phase as a **separate invocation** (`?phase=load|build|persist|compress|put`), each returning only sizes/counts, then read each invocation's `cpuTimeMs`.
- Profiles: `cf workers versions profile <version> --worker-id <id>` captures CPU or heap profiles of a recently active isolate (`workers/observability/profiling-in-production.mdx`); heap profile = allocations, not retained size. Local: DevTools CPU/memory snapshot (`dev-tools/cpu-usage.mdx`, `memory-usage.mdx`).
- Memory has no direct gauge; failure shows as outcome `exceededMemory` / error 1102 (`limits.mdx:132`). Measure headroom by **scaling the corpus** (1x, 2x, 4x, 8x duplicated docs) in a preview until it OOMs.

### 6.6 Spike design (do not run)

Goal: prove or disprove "build the index for all published articles inside one Worker invocation, with Slovenian stemming, seqproto, brotli, upload to R2", and measure everything issue #45 measured, but where it will actually run.

Branch: `spike/zbsearch-worker` (temp, never merged). Add, as separate files only:

- `lib/zbsearch-build.ts`: port of `scripts/zbsearch-bench.ts` core: `load_articles` (Drizzle through the request-scoped `db` over Hyperdrive; reuse `convert_content_to_text`, `format_author_sort_name`, `find_primary_slug_or_first`), `create({ schema, components: { tokenizer: { stemming: true, stemmer, language } } })` (BM25 only; no QPS), `insert` loop, `persist(db, "seqproto")`, `brotliCompressSync`. Drop `process.memoryUsage`, `heapUsed`, `process.exit`, and the `json`/`binary` format matrix (keep `json` only in the local Node variant for parity).
- `app/api/dev/search-spike/route.ts` (Route Handler, `force-dynamic`, guarded by a secret header from `bindings.secret()`): `GET ?phase=` in `load | build | persist | compress | put | all | verify`, plus `&scale=N` (duplicate corpus with new ids) and `&q=<brotli level>`. Each returns JSON of sizes/counts only (no timers). `put` writes `search/spike-<hash>.zbs` and `search/spike-manifest.json` to the `MEDIA`-or-scratch R2 bucket with `contentEncoding: "br"`.
- A second variant of the same function as a Queue consumer + `scheduled` handler in the custom worker entry, to measure the 5-min/30-s CPU class and the cold-start cost of the stemmer import. If startup breaks, move to an auxiliary Worker.
- Keep `scripts/zbsearch-bench.ts` unchanged and run it in Node as the **baseline** (same DB, same corpus).

Local steps:

1. Node baseline: `vpx scripts/zbsearch-bench.ts` (BM25 rows only). Record raw/gzip/brotli sizes, restore ms, search ms, hits for `"jama"` (expected 487 per issue #45), plus build ms (`create`+`insert` loop, `persist` ms), which the old script did not time.
2. `vp dev` with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` set; call each phase; compare sizes byte-for-byte with Node (same seqproto size, same search hits for a fixed 20-query list). Local timers allowed here for rough CPU. Run with a DevTools CPU profile.

Deployed preview steps: 3. Create a scratch Hyperdrive config **with caching disabled**; add the bindings in `cloudflare.config.ts` under `isPreview`; `vpx @vinext/cloudflare previews deploy spike` (or `cf previews deploy`). `observability.enabled` on. 4. Per phase, call twice (cold then warm isolate) and record from Workers Logs: `$workers.cpuTimeMs`, wall time, outcome; any `exceededCpu`/`exceededMemory`. 5. `scale` sweep 1x, 2x, 4x, 8x on `phase=all` to locate the memory/CPU cliff; brotli q9 vs q11. 6. Run `phase=put`, fetch the artifact from the R2 custom domain in a real browser: transfer size, `content-encoding`, cache headers, `cf-cache-status` on second hit, restore time + first-search time in the browser (Chrome on a throttled CPU), heap in DevTools. 7. Concurrency test: fire 3 `phase=build` calls at once to see isolate memory sharing behavior (a single isolate can serve many requests; memory is per isolate, `limits.mdx:126`). 8. Also exercise in the same preview: the 2-concurrent-publish `FOR UPDATE` race (2.4) and a publish-then-read freshness check (2.5), since the spike is the first deployed Hyperdrive path.

Record: article count/bytes, sizes (raw/brotli, per q), per-phase CPU ms (cold/warm), outcome codes, worker bundle size and startup validation result, search hits for 20 queries vs Node, browser restore/search ms, cache headers and hit status.

Thresholds (proposed):

| Metric                                     | Pass                                                 | Warn                                                          | Fail                                                               |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Total build CPU, 1x corpus, one invocation | <= 15 s                                              | 15-60 s (works only with raised `cpuMs`; run from Queue/Cron) | > 120 s or any `exceededCpu` at 1x                                 |
| Memory at 1x                               | no `exceededMemory`                                  | OOM between 2x and 3x                                         | OOM at <= 2x (headroom too thin; move build to Node/GitHub Action) |
| Growth headroom                            | 4x corpus completes within 5 min CPU and no OOM      | 3x                                                            | < 3x                                                               |
| Artifact (brotli, seqproto)                | <= 1.6 MB (issue #45: 1.43 MB)                       | <= 2.2 MB                                                     | > 2.2 MB                                                           |
| Browser restore                            | <= 400 ms (issue: 243 ms Node)                       | <= 800 ms                                                     | > 800 ms                                                           |
| Search                                     | median <= 10 ms                                      | <= 25 ms                                                      | > 25 ms                                                            |
| Parity                                     | identical hit counts on 20 fixed queries vs Node     |                                                               | any mismatch                                                       |
| Startup                                    | deploy validates, `fetch` path unaffected by stemmer | needs lazy import                                             | > 1 s startup                                                      |
| Two concurrent publishes                   | second fails cleanly                                 |                                                               | both succeed / deadlock / error                                    |
| Publish-then-read                          | fresh                                                |                                                               | stale (Hyperdrive cache on)                                        |

Decision rule: all pass -> Queue consumer + Cron in the app Worker. Any memory/CPU fail -> separate auxiliary Worker first; still failing -> Node builder in GitHub Actions uploading to R2.

---

## Other repos/docs needed but not local

- Supabase docs: direct vs pooler IPv4/IPv6, Supavisor session/transaction semantics, free-tier pausing (2.7).
- `node-postgres` source/docs (queries before `connect()`, Pool lifecycle) and `@t3-oss/env-core` docs (1.5).
- The `cf` CLI repo/docs (`cloudflare/cf`): whether `cf deploy` enforces `secrets.required`, `cf hyperdrive create` caching flag, and `vinext-cloudflare deploy` secrets passthrough (1.6, 2.5).
- Next.js docs on `updateTag` and the production error redaction contract (I read only vinext's implementation).
- Real-world D1 `BEGIN` behavior (3.1) and Cloudflare R2 public-bucket compression/cache behavior (6.4).
- Cloudflare docs for `waitUntil` exported from `cloudflare:workers` (5.2).
- Workers Cache purge limits and billing for `revalidatePath` fan-out (vinext `caching.mdx` mentions shared Free-tier purge limits for the Workers Cache adapter; the Response Store's own accounting wasn't read).
- zbsearch published npm 4.0.1 metadata (is `workspace:*` fixed?), issue #44 in `lukaprsina/jknm`.
- Old-repo production state: `account` table columns, Supabase plan.

## Open risks, ranked by likelihood of forcing a design change

1. **Hyperdrive query caching (certain unless handled).** Default 60 s cache with no write invalidation breaks read-your-writes after `updateTag`, session reads and tests. Design change: caching-disabled Hyperdrive config. Cheap but mandatory; invisible in `vp dev`.
2. **better-auth schema mismatch (very likely).** Old schema's required `issuer` + unique index blocks sign-in on >= 1.7.3; the handoff plan is inverted. Change: remove from schema, relax production column. Low effort, high blast radius if missed.
3. **Supabase connectivity (likely).** Current URL is the 6543 transaction pooler; Hyperdrive wants direct/session. IPv6/IPv4 reachability unverified. Could force a plan change (IPv4 add-on, session pooler, or a different Postgres host). The 2.7 fallback exists.
4. **Request-scoped db/auth seam (likely, design known).** Proxy + ALS vs explicit `getDb()`; auth per request vs per isolate; per-request Pool vs Client. Pick after the first smoke test. Interacts with the custom worker entry.
5. **Search build memory (medium).** 128 MB isolate with stemmed index build + export + serialise. Failure moves the build to a separate Worker or GitHub Action (trigger design only, not the client architecture).
6. **Custom worker entry vs Vinext multi-stage/Response Store exports (medium).** Need `export *` plus `scheduled`/`queue`; unverified composition with service-binding mode. Failure forces a separate cron/queue Worker.
7. **Transactions/`FOR UPDATE` through Hyperdrive (low-medium).** Docs imply it works, never state it. Failure would push toward D1 or application-level locking (unique constraints + retry).
8. **Beta toolchain churn (medium, slow).** `@cloudflare/config` ("not stable for external use"), `cf` beta.21, `@cloudflare/vite-plugin` 2.0 beta, `vinext` 1.x moving fast (installed 1.3.1 vs 1.4.0). Pin versions; re-read changelogs before upgrades.
9. **Vinext caching semantics (medium-low).** Response Store with `updateTag` is implemented, but nobody has run this app on it. Dynamism is learned while rendering, so session-reading routes should be `force-dynamic`. `unstable_cache` JSON serialisation keeps the Date workaround.
10. **zbsearch maturity (low-medium).** ~5 weeks old, one maintainer, QPS broken, `workspace:*` publish bug; vendoring/pinning (as in issue #45) is the mitigation.
11. **Images cost/caching (low).** Unique-transformation billing and uncached binding calls; mitigate with Workers Cache or pre-generated R2 variants.
12. **D1 (low, only if 7 or 3 fail).** See section 3.

## Sources

Local repo: `cloudflare.config.ts`, `vite.config.ts`, `package.json`, `docs/00_HANDOFF.md`, `.env.local` (names only), `node_modules/{vinext,@vinext/cloudflare,cf,@cloudflare/vite-plugin,.pnpm/@cloudflare+config@0.28.0}`.

Old repo (`.references/jknm`, `89d48c2`): `src/server/db/index.ts`, `db/test-helpers.ts`, `db/schema.ts`, `server/article/{lifecycle,new-article,slug,reconcile-media}.ts`, `server/auth/index.ts`, `server/cache-invalidation.ts`, `lib/cache-policy.ts`, `lib/revive-cache-dates.ts`, `app/si/route.ts`, `next.config.ts`, `drizzle.config.ts`, `src/env.js`, `scripts/zbsearch-bench.ts`, `scripts/migrate/backfill-account-issuer.ts`, `docs/adr/0005,0006`, `docs/architecture.md`.

Cloudflare docs (`~/code/repos/cloudflare/cloudflare-docs/src/content/`): `compatibility-flags/nodejs-compat-populate-process-env.md`; `docs/workers/{configuration/environment-variables,configuration/secrets,configuration/cron-triggers,runtime-apis/bindings/index,runtime-apis/nodejs/process,runtime-apis/nodejs/zlib,runtime-apis/performance,runtime-apis/handlers/scheduled,platform/limits,reference/security-model,observability/profiling-in-production,observability/query-builder,observability/dev-tools/{cpu-usage,memory-usage}}.mdx`; `partials/workers/secrets-in-dev.mdx`; `docs/hyperdrive/{concepts/{connection-lifecycle,connection-pooling,query-caching,how-hyperdrive-works},configuration/local-development,platform/limits,reference/supported-databases-and-features,observability/troubleshooting,examples/connect-to-postgres/**/{drizzle-orm,node-postgres,supabase,fly}}.mdx`; `partials/hyperdrive/{pooling-mode,node-postgres-recommendation,use-node-postgres-to-make-query}.mdx`; `docs/d1/{worker-api/d1-database,platform/limits}.mdx`; `docs/queues/{platform/limits,configuration/batching-retries}.mdx`; `docs/workflows/reference/limits.mdx`; `docs/images/{pricing,optimization/binding}.mdx`; `docs/r2/{api/workers/workers-api-reference,api/s3/extensions,buckets/cors}.mdx`.

workers-sdk (`~/code/repos/cloudflare/workers-sdk/packages/`): `config/src/{convert,bindings,triggers}.ts`, `miniflare/src/config/local-bindings.ts`, `workers-utils/src/environment-variables/factory.ts`, `vite-plugin-cloudflare` (installed beta.v.4 `dist/index.mjs:84929-84947, 89402-89440, 90157`).

Vinext (`~/code/repos/cloudflare/vinext`, clone 1.4.0; installed 1.3.1): `docs/{caching,deploying/cloudflare,reference/differences,getting-started/migrating,tracing}.mdx`; `packages/vinext/src/{index.ts,check.ts,shims/cache.ts,server/{metadata-routes,app-server-action-execution,fetch-handler,app-middleware}.ts,config/dotenv.ts,image/image-adapters-virtual.ts}`; installed `dist/{shims/cache.js,server/app-rsc-errors.js,server/app-server-action-execution.js,index.js,config/dotenv.js}`; `packages/workers-response-store/README.md`; `node_modules/@vinext/cloudflare/dist/{cache/response-store-data.runtime.js,images/images-optimizer*.js}`; `examples/app-router-cloudflare/worker/index.ts`.

Drizzle (`~/code/repos/drizzle-team/drizzle-orm` 0.45.4): `drizzle-orm/src/{node-postgres/{driver,session}.ts,d1/session.ts}`, `integration-tests/tests/sqlite/d1.test.ts`; `drizzle-orm-docs/src/content/docs/{pg/connect-supabase,sqlite/{transactions,batch-api}}.mdx`.

better-auth (`~/code/repos/better-auth/better-auth`, 1.7.14): `docs/content/blogs/1-7-account-schema.mdx`, `docs/content/docs/guides/{1-7-upgrade-guide,dynamic-base-url,optimizing-for-performance}.mdx`, `docs/content/docs/{concepts/{database,rate-limit,session-management},authentication/google,installation,reference/options,integrations/hono}.mdx`, `packages/core/src/social-providers/google.ts`, `packages/core/src/types/init-options.ts`.

zbsearch (`~/code/repos/micheleriva/zbsearch`, 4.0.1): `apps/docs/content/docs/cloudflare/{index,setup,indexing-and-rebuilds,local-development,production,cost-calculator,benchmarks,api-reference}.mdx`, `packages/plugin-data-persistence/src/{index,seqproto}.ts`, `packages/{plugin-data-persistence,plugin-qps,stemmers}/package.json`; GitHub issue `lukaprsina/jknm#45` (via `gh`).

CLI discovery used: `cf cli search` ("set worker secret", "deploy worker", "create hyperdrive configuration", "create r2 bucket", "create queue"), `cf deploy --help`, `cf workers secrets bulk --help`, `cf hyperdrive create --help`.
