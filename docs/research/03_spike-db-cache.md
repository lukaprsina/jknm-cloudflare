# Spike: Hyperdrive/Drizzle seam, Server Actions, cache (run, not read)

Run 2026-10-31 on branch `spike/db-cache` (from `docs/research-handoff`). Everything below was executed locally against the real toolchain: `vp dev`, `vp build` + `vp preview` (workerd via the Cloudflare Vite plugin), `vp test`. Nothing was deployed and no Cloudflare resource was created or modified. The only DB writes went to the scratch table `spike_hyperdrive_probe`, which was dropped at the end (verified: `to_regclass` returns null). Only read-only `SELECT ... LIMIT 5` ran against the real `articles` table, and only column names and row counts were printed. No credentials appear in this file or in git.

Versions actually installed (after `vp install`): `vinext` 1.4.0, `@vinext/cloudflare` 1.3.0, `@cloudflare/workers-response-store` 1.1.4, `@cloudflare/vite-plugin` 2.0.0-beta.v.4, `cf` 1.0.0-beta.21, `drizzle-orm` 0.45.4, `pg` 8.23.1, `@electric-sql/pglite` 0.5.13, `drizzle-kit` 0.31.11, vitest 5.0.5 (via vite-plus). Report 01 listed older vinext numbers (1.3.1 / 1.2.1 / 1.1.3).

## Summary of verdicts

| #   | Question                                                                          | Verdict                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hyperdrive binding, local conn string, `process.env`, `cloudflare:workers` import | **PASS** (dev and preview). Two new gotchas: `vp test` breaks without the plugin guard, and the dev `connectionString` is a fake host.                                                                                                                                                                            |
| 2   | `pg` + Drizzle + ALS `db` proxy in route handler and Server Action; pglite typing | **PASS** (dev and preview, both `Client` and per-request `Pool`). Pglite is assignable to the `Db` type with no cast. One new hazard: never `pool.end()` when `fetch` returns (streaming).                                                                                                                        |
| 3   | Interactive transactions, `FOR UPDATE`, rollback                                  | **PARTIAL.** Commit, rollback, savepoint and lock contention all PASS, over the Supabase transaction pooler (6543) locally. Hyperdrive's own pooler is not exercised locally: **NOT TESTABLE LOCALLY**. Human steps below.                                                                                        |
| 4   | Which DATABASE_URL form                                                           | **Transaction pooler, port 6543** (Supavisor). Do not use it as the Hyperdrive origin. Session pooler 5432 on the same host works from here; the direct host was unreachable from this machine (ENETUNREACH).                                                                                                     |
| 5   | Server Action error redaction                                                     | **PASS.** Production build redacts (digest only, client sees React error #441); dev leaks message and stack. `Result` return passes through untouched. Report 01 4.1 confirmed.                                                                                                                                   |
| 6   | `unstable_cache` + `updateTag` / `revalidateTag`, Dates                           | **PASS locally** (dev and production build, identical). Read-your-writes with `updateTag` and with `revalidateTag` (no profile); SWR with `"max"`. Dates become strings. **New: `revalidateTag` called from a `scheduled` handler is a silent no-op.** Deployed Workers Cache/DO layers **NOT TESTABLE LOCALLY**. |
| 7   | Report 01 corrections                                                             | See the last section: 8 items.                                                                                                                                                                                                                                                                                    |

## Evidence

### Spike layout (all deletable)

- `app/spike/**` (probe routes, actions, cache page), `lib/spike/**` (`db.ts` proxy, `pg-db.ts`, `cf-env.ts`, `cached.ts`, `schema.ts`, `worker-entry.ts`, pglite test), `scripts/spike-*.{sh,mjs}`.
- `scripts/spike-env.sh` reads `DATABASE_URL` from `.env.local` and exports it as `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (and `SPIKE_DATABASE_URL` for scratch scripts) without printing it, then execs a command. `.env.local` was never modified.
- Non-spike changes on the branch you may want to keep: `vite.config.ts` (see 1 and the pglite test), `package.json` deps.
- Because a user dev server (PID 88446, `http://localhost:5173`) was already running in this directory, probes used `VINEXT_NO_DEV_LOCK=1` and ports 5197-5199. Both servers share `.cloudflare/state`; I saw one `SQLITE_BUSY` from workerd during the overlap. Not a product issue, just a spike artifact.

### 1. Env and bindings: PASS

Config (`cloudflare.config.ts`): `HYPERDRIVE: bindings.hyperdrive({ id: "<placeholder>" })`, `SPIKE_TEXT: bindings.text("...")`, `BETTER_AUTH_SECRET: bindings.secret()`. `id` is required by the type (`HyperdriveBindingOptions`, `public-DsUKmT49.d.mts:1386`); `dev.connectionString` is optional. The placeholder id was never sent anywhere.

`GET /spike/env` under `vp dev` and `vp preview`:

- `Object.keys(env)` = `ASSETS, BETTER_AUTH_SECRET, CF_VERSION_METADATA, HYPERDRIVE, IMAGES, RESPONSE_STORE, SPIKE_TEXT`.
- `Object.keys(process.env)` = `BETTER_AUTH_SECRET, CF_VERSION_METADATA, SPIKE_TEXT`. So **text and secret bindings are in `process.env`; `HYPERDRIVE`, `IMAGES`, `ASSETS` are not.** `DATABASE_URL` and `AWS_*` are absent although they are in `.env.local` (only declared bindings reach the Worker). Secret values come from `.env.local` (length 44 seen from both `env` and `process.env`).
- `import { env } from "cloudflare:workers"` read at **module scope** works (`moduleScopeText` was `"spike-text-value"`).
- `env.HYPERDRIVE` has keys `connectionString, port, ip, host, password, user, database`. The `connectionString` is `postgresql://...@<32-hex>.hyperdrive.local:5432/...`, a **fake host**. workerd's local Hyperdrive proxies the socket to the real database (including TLS to the Supabase pooler). So code must use `env.HYPERDRIVE.connectionString` (or host/port/user/password fields) and never expect the real URL.
- Local string wiring:
  - Env var `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` from the shell: works.
  - Same variable in a dotenv file: works. I verified with a throwaway `.env.development` containing a dummy unreachable URL; the dev server started and the DB connection failed with "connection attempt failed" (binding configured), then I deleted the file. I did not put the real URL into `.env.local`. The `.env.local` route is therefore verified by analogy, not directly.
  - Neither present: `vp dev` fails to start with `Hyperdrive binding "HYPERDRIVE" must define dev.connectionString for local development.` `vp build` does **not** need it (exit 0 without it).
- **New finding: `vp test` loads `vite.config.ts` including the vinext and Cloudflare plugins.** Without the Hyperdrive local string it dies with the error above ("Startup Error"), even for a pure pglite test; with it, it boots workerd. It also picked up the 25 test files under `.references/jknm` (11 failed). Fix applied in `vite.config.ts`: `plugins: lazyPlugins(() => process.env.VITEST ? [] : [...])` and `test.exclude = [".references/**", "node_modules/**", ".cloudflare/**", "dist/**"]`. After that `vp test` runs in ~3 s with no env.
- `vp check` (type-aware lint) is wired into the pre-commit hook and rejects TS errors; it caught two real typing issues listed in section 7.

### 2. Driver and db seam: PASS

Code: `lib/spike/db.ts` (type `Db = PgDatabase<PgQueryResultHKT, typeof schema>`, `AsyncLocalStorage` store, `runWithDb`, `db` Proxy that binds methods), `lib/spike/pg-db.ts` (`withRequestDb(fn, "client" | "pool")`), `lib/spike/cf-env.ts` (only importer of `cloudflare:workers`).

- Route handler `GET /spike/db?mode=pool|client`, both under `vp dev` and `vp preview`: `select 1` ok, `select * from articles limit 5` returned `rowCount` 5 with 21 columns (`id, legacy_id, status, title, excerpt, content_json, thumbnail_media_id, thumbnail_x/y/width/height, supersedes_id, created_by, created_at, updated_at, published_at, archived_at, deleted_at, published_year, uploaded_custom_thumbnail, article_kind`), and `Promise.all` of two queries ok on the same `db`. Latency 200-550 ms including connect.
- Server Action: `app/spike/actions.ts` bump actions call `withRequestDb(() => db.update(...))` and run in dev and preview (status 200, row incremented in the DB).
- One transient failure on the very first dev request ("no request-scoped db"), coinciding with a Vite dependency re-optimization reload; not reproducible afterwards. Probably two module instances during the reload. Mentioned for completeness.
- **Custom worker entry works** (`lib/spike/worker-entry.ts`, `entrypoint` in `cloudflare.config.ts` pointed at it): `export * from "vinext/server/fetch-handler"` plus `default = { fetch, scheduled }` composes cleanly with the Response Store service binding (cache test re-run on it passed). `fetch` wrapped in `runWithDb(drizzle(new Pool(...)))`, and `scheduled` invoked through `GET /cdn-cgi/local/scheduled?cron=x` ran DB code through the same proxy. `queue` was not tested. Note `/cdn-cgi/handler/scheduled` returns 404 here; the working URL is `/cdn-cgi/local/scheduled`.
- **Streaming hazard (new, important).** In production RSC streams after `fetch()` resolves (`/spike/stream`, a Suspense child that queries after 1.5 s: TTFB 58 ms, total 1.55 s). If the wrapper calls `pool.end()` when the Response is returned (`?end=1` variant, via `ctx.waitUntil(r.then(pool.end))`), the late Suspense child fails with `Cannot use a pool after calling end on the pool` (digest error in the stream). Without the early `end()` the same page works. So the request-scoped pool must not be ended at response return; Hyperdrive docs say `end()` is not required anyway. In dev the whole response was buffered (TTFB equals total), so this only reproduces in the production build.
- Pglite: `lib/spike/db.pglite.test.ts`, 3 tests pass under `vp test`. It builds `drizzle-orm/pglite` with `pushSchema` from `drizzle-kit/api` (same approach as the old repo's `server/db/test-helpers.ts`), then `runWithDb(testDb, ...)` and uses the `db` proxy for insert, `for("update")` transaction, rollback-on-throw and a Date column. `const asDb: Db = testDb;` type-checks with **no `as unknown as` cast** (`vp check` passes). The proxy throws a clear error outside `runWithDb`. Limitation: `Db` typed with the base `PgQueryResultHKT` makes `db.execute()` return `unknown`; code that needs `rows` must cast (the old `src/` has no `.execute()` calls, so low impact).

### 3. Transactions: PARTIAL

`GET /spike/tx?mode=pool|client` (scratch table only), identical in dev and preview:

- Commit: `select ... for("update")` + update in `db.transaction` committed (counter 0 -> 1).
- Rollback on throw: update to 99, read inside the tx saw 99, callback threw, after the throw the counter was still 1.
- Savepoint: inner `tx.transaction` threw and was caught; outer committed with only its own change (2).
- Contention (pool mode, two concurrent transactions each doing `FOR UPDATE`, 400 ms hold, +1): A got the lock at ~90-130 ms and saw 2; B got the lock at ~580-640 ms (after A committed) and saw 3; final counter 4. No lost update, total 1.2 s. The lock really serialized them.
- `client` mode (single connection): commit, rollback and savepoint pass; contention is not meaningful on one connection.

What this does and does not prove: the connection went workerd -> local Hyperdrive stub -> **Supabase Supavisor transaction pooler (port 6543)** (see 4). That proves `pg` + Drizzle transactions and row locks work through a transaction-mode pooler. It does **not** exercise Hyperdrive's pooler, its pinning of a connection for the duration of a transaction, its query cache, or its connection limits. Those are only testable deployed. Human steps are in the last section.

### 4. DATABASE_URL form

Pattern only: `postgresql://postgres.<project-ref>:<password>@aws-N-<region>.pooler.supabase.com:6543/postgres`, no query params. A comment in the file refers to a Supabase project migration and a `?workaround=supabase-pooler.vercel` note. This is the **Supavisor transaction pooler**.

Connectivity checks from this machine (`select 1`): pooler `:6543` OK, pooler `:5432` (session mode, same host and user) OK, direct host `db.<ref>.supabase.co:5432` **ENETUNREACH** (this machine has no IPv6 route, consistent with the direct host being IPv6-only; I did not confirm DNS family).

Implication for report 01 2.7: Hyperdrive must not be pointed at the current 6543 URL (double transaction pooling, Supavisor forbids session state). Use either the direct host (needs Hyperdrive to reach IPv6, **NOT TESTABLE LOCALLY**) or the session pooler on 5432, which is IPv4 and does work from here. Recommend creating the Hyperdrive config with the session pooler 5432 first, and switching to the direct host only if desired. `drizzle-kit push` from this machine therefore also needs the session pooler (5432), not the direct host.

### 5. Server Actions: PASS

`app/spike/actions.ts`: `resultAction(n)` returns `Result<{doubled}>` (`{ok:false,error:"Negativno število ni dovoljeno"}` for negatives); `throwingAction()` throws `Error("SECRET-INTERNAL-MESSAGE ...")`. Called both with raw `fetch` (`Next-Action` header, `scripts/spike-action-test.mjs`) and from the browser (agent-browser clicking buttons in a client component, `app/spike/cache/buttons.tsx`).

| Build              | `resultAction`            | `throwingAction` response                                                                               | what the client catch saw                                                            |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `vp dev`           | 200, value passes through | 500; `1:E{"digest":"...","message":"SECRET-INTERNAL-MESSAGE Napaka v bazi","stack":[...file paths...]}` | n/a (not run in browser)                                                             |
| `vp build`+preview | 200, value passes through | 500; `1:E{"digest":"3394603909"}` only                                                                  | `Minified React error #441; ...`, `digest=3394603909` (the message is NOT available) |

The real error is logged server-side: `[vinext] Server action error: Error: SECRET-INTERNAL-MESSAGE ...` in the preview log. Conclusion: same as Next. Keep returning `Result`; throw only for programmer errors. Action ids differ: dev ids look like `/app/spike/actions.ts#name`, production ids are `<hash>#name`.

### 6. Cache: PASS locally, one new failure mode

Wiring: the Response Store service binding already in `cloudflare.config.ts` (`RESPONSE_STORE` visible in `env`, referenced in the built bundle; the Response Store worker runs as an auxiliary worker in dev and preview). Cached function (`lib/spike/cached.ts`): `unstable_cache(readProbeRow, ["spike-cache"], { tags: ["spike"], revalidate: 3600 })`, read from a route handler and a `force-dynamic` page. `scripts/spike-cache-test.mjs` compares the cached value to the real DB counter after each step. **Dev and the production build gave the same results**, and the same again with the custom worker entry.

| Step                                                         | Result                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| two reads                                                    | second is a hit (`readAt` unchanged)                                                                                                                                                                           |
| action: write, no invalidation                               | cache stale (as expected)                                                                                                                                                                                      |
| action: write + `updateTag("spike")`                         | **next read, in the same navigation and on every later request, shows the write.** In the browser the action response itself re-rendered the page with the new counter (12 -> 14), i.e. read-your-writes holds |
| action: write + `revalidateTag("spike")` (no profile)        | also immediate (hard purge)                                                                                                                                                                                    |
| action: write + `revalidateTag("spike", "max")`              | **stale-while-revalidate:** first read after still old (counter 9), refreshed in the background, second read new                                                                                               |
| `updateTag` from a Route Handler                             | throws: `updateTag can only be called from within a Server Action. To invalidate cache tags in Route Handlers or other contexts, use revalidateTag instead`                                                    |
| `revalidateTag` from a Route Handler, with / without `"max"` | works (immediate / SWR)                                                                                                                                                                                        |
| Date column (`timestamptz`, node-postgres returns `Date`)    | miss: `Date`; hit: ISO **string**. `revive-cache-dates` is still required.                                                                                                                                     |
| restart `vp preview`                                         | first read re-ran the function (the local cache did not survive a preview restart)                                                                                                                             |

**New: `revalidateTag` from the `scheduled` handler does nothing.** `lib/spike/worker-entry.ts` `scheduled()` dynamically imports `next/cache` and calls `revalidateTag("spike", {expire:0})`: it returns without error, logs success, and the cached entry is not invalidated (DB 820 vs cached 720, reproduced in dev and preview). The same invalidation routed through `handler.fetch(new Request("http://localhost/spike/cache/outside?fn=revalidateTag"), env, ctx)` (an internal Route Handler running inside the vinext RSC environment) works (cache refreshed to the new value). Likely cause: the entry bundle has its own copy of the cache shim without the registered Response Store handler. I did not confirm the mechanism. Consequence: Cron/Queue consumers must invalidate by calling a Route Handler (or the vinext handler) rather than importing `next/cache` themselves.

Not verified (needs a deployment): whether Workers Cache / CDN purge and the Durable Object tag store behave the same in production, and `cf-cache-status` behavior.

#### What the new adapters under `lib/cache-policy.ts` need

Read: `.references/jknm/docs/adr/0005-stay-on-unstable-cache.md`, `0006-no-isr-on-article-pages.md`, `src/lib/cache-policy.ts`, `src/server/cache-invalidation.ts`.

- `cache-policy.ts` itself is pure and unchanged. The `query_keys` and `PUBLISHED_FEED_QUERY_KEY` part goes away with TanStack Query (handoff proposal), the rest stays, reachability test included.
- `apply_server_invalidations(event)` (`updateTag` per tag + `revalidatePath` per path): works as is on Vinext (both exist and behave as in Next in actions, verified above; `revalidatePath` was not exercised in this spike beyond its existence in the shim). Keep the comment that it must be called inside a Server Action.
- `apply_route_invalidations` (`revalidateTag(tag, "max")` + `revalidatePath`): the internal revalidate route is on the DROP list, but a non-action adapter is still needed for Cron/Queue-initiated changes (e.g. the sweep job, member sync). Implement it as "call an internal Route Handler via `handler.fetch`" (see finding above), not as a direct `next/cache` import in the Worker entry. Typing: `revalidateTag` requires the second argument under vinext/Next 16 types (TS2554 on one argument); `"max"` is SWR, `{ expire: 0 }` is a hard purge (verified no-profile form is also a hard purge at runtime).
- ADR-0005 stays right: `use cache` is not an option, `unstable_cache` JSON-serialises (verified), `revive_cache_dates` stays, including in `unstable_cache` wrappers that return rows with `*_at` columns.
- ADR-0006 stays right, with the extra requirement that cached functions read the db through the ALS proxy, so they must be called inside the request scope (they are, as long as the entry wraps `fetch`; verified inside `unstable_cache` callbacks).
- The `unstable_cache` key includes the function source plus key parts, so changing the function body invalidates old entries; no action needed, just know it on deploy.

## Recommended seams

Sketches reflect code that ran in this spike (see `lib/spike/`). Names should follow the old repo's snake_case where you port.

**Env module** (`lib/cf-env.ts`, the only importer of `cloudflare:workers`; validate lazily, never at import):

```ts
import { env } from "cloudflare:workers";
import { z } from "zod";
const schema = z.object({
  HYPERDRIVE: z.object({ connectionString: z.string() }),
  BETTER_AUTH_SECRET: z.string().min(32),
  // ...
});
let cached: z.infer<typeof schema> | undefined;
export const getServerEnv = () => (cached ??= schema.parse(env));
```

`NEXT_PUBLIC_*` stay build-time literals in a separate client module. Only bindings declared in `cloudflare.config.ts` exist at runtime; `DATABASE_URL` in `.env.local` is irrelevant to the Worker (keep it for `drizzle-kit`).

**db proxy** (`server/db/index.ts`, as in `lib/spike/db.ts`): `type Db = PgDatabase<PgQueryResultHKT, typeof schema>`, `AsyncLocalStorage<{ db: Db }>`, `runWithDb`, and `export const db: Db = new Proxy(...)` that does `typeof v === "function" ? v.bind(target) : v`. Production client creation lives in one file (`server/db/pg.ts`) that imports `pg`, `drizzle-orm/node-postgres` and `getServerEnv()`. Tests do `runWithDb(pgliteDb, ...)` or pass the pglite db to functions that take `db_conn`; no cast needed.

**Worker entry** (`worker/index.ts`, set as `entrypoint`):

```ts
import handler from "vinext/server/fetch-handler";
export * from "vinext/server/fetch-handler";
const withDb = <T>(env: Env, fn: () => T) =>
  runWithDb(
    drizzle(new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 5 }), {
      schema,
    }) as unknown as Db,
    fn,
  );
export default {
  fetch: (req, env, ctx) => withDb(env, () => handler.fetch(req, env, ctx)), // do NOT pool.end() here
  scheduled: (c, env, ctx) => withDb(env, () => runCron(c, env, ctx)),
};
```

Use a per-request `Pool` (lazy connect, one dedicated client per transaction, `Promise.all` safe). A single `Client` also works but any concurrent query on it during a transaction would join the transaction.

**Action helper** (`lib/action.ts`):

```ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export const action =
  <I, O>(schema: z.ZodType<I>, run: (i: I, s: Session) => Promise<O>) =>
  async (raw: unknown): Promise<Result<O>> => {
    const session = await getSession();
    if (!session) return { ok: false, error: "Ni dovoljenja" };
    const p = schema.safeParse(raw);
    if (!p.success) return { ok: false, error: formatZod(p.error) };
    try {
      return { ok: true, data: await run(p.data, session) };
    } catch (e) {
      if (isDomainError(e)) return { ok: false, error: e.message };
      throw e;
    } // programmer errors throw and get redacted
  };
```

Wrap the exported function in a `"use server"` file. Inside, call `apply_server_invalidations(event)` after the mutation, still in the action.

**Cache adapter** (`server/cache-invalidation.ts`): keep `apply_server_invalidations` unchanged. Add `apply_internal_invalidations(event)` implemented by `fetch`ing `/__internal/invalidate?event=...` through the vinext handler from cron/queue code (guard it with a binding-only secret or an internal-origin check), whose Route Handler calls `revalidateTag(tag, "max")` and `revalidatePath(path)`. Keep `revive_cache_dates` around every `unstable_cache` read.

## Human steps for deployed verification

Prerequisites: a Cloudflare account profile with deploy rights; do this on a scratch Worker name and a scratch Supabase table (never production tables for writes). Items marked (human) create resources and were deliberately not done here.

1. **Create the Hyperdrive config with caching disabled** (human). The `cf hyperdrive create` command has **no caching flags**; disable it with `update` afterwards (`cf hyperdrive update` and `replace` have `--caching-disabled`):

   ```bash
   cf hyperdrive create --name jknm-spike --origin-scheme postgres \
     --origin-host <aws-N-region>.pooler.supabase.com --origin-port 5432 \
     --origin-database postgres --origin-user 'postgres.<project-ref>' --origin-password '<password>'
   cf hyperdrive update <hyperdrive-id> --caching-disabled
   cf hyperdrive get <hyperdrive-id>        # confirm caching.disabled is true
   ```

   The origin is the Supabase session pooler on 5432, not the 6543 transaction pooler from `.env.local`. To test the direct host instead, use `db.<project-ref>.supabase.co:5432` with user `postgres` and check that Hyperdrive can reach it (IPv6).

2. Put the id in `cloudflare.config.ts`: `HYPERDRIVE: bindings.hyperdrive({ id: "<hyperdrive-id>" })` (it can come from a `mode`-based function). Secrets: `cf deploy --secrets-file secrets.json` with `BETTER_AUTH_SECRET` etc.
3. Deploy the response-store worker first, then the app: `vp build`, `pnpm run deploy:response-store`, then `pnpm run deploy` (or `cf deploy --prebuilt --mode production`). The spike routes (`/spike/*`) are included in the build; remove them before a real release.
4. Scratch table (human, once, from a machine with DB access): `create table spike_hyperdrive_probe (id serial primary key, label text not null, counter integer not null default 0, created_at timestamptz not null default now()); insert into spike_hyperdrive_probe(label,counter) values ('cache',0);`
5. **Deployed transaction test:** `curl https://<worker>.workers.dev/spike/tx?mode=pool`. Expected: `afterCommit` 1, `afterRollback` 1, `afterSavepoint` 2, `contention` shows B's `gotLockAt` roughly 400 ms after A's and `afterContention` 4 (3 means a lost update, i.e. locking failed). Repeat 20 times in parallel (`seq 20 | xargs -P20 -I{} curl -s .../spike/tx?mode=pool`) and then check `select count(*), max(counter) from spike_hyperdrive_probe` to confirm no connection errors under concurrency (`Too many connections` or timeouts would show in `wrangler tail`/`cf` logs). Also run with `?mode=client`.
6. **Deployed cache test** (against the deployed URL, using the same scripts but pointing `base` at the worker; the scripts read the DB directly through `SPIKE_DATABASE_URL`, run them from a machine that has it): `scripts/spike-env.sh node scripts/spike-cache-test.mjs https://<worker>.workers.dev`. Pass criteria: every "after bump+updateTag" and "after bump+revalidateTag(1 arg)" line has `route.counter == db`; "after bump, no invalidation" is stale; also inspect `curl -I .../spike/cache/read` for `cf-cache-status` (route is `force-dynamic`, so it should not be edge-cached). Then flip the Hyperdrive config to caching **enabled** (`cf hyperdrive update <id> --caching-max-age 60`, re-enable caching) and repeat: if "after bump+updateTag" now shows a stale counter for up to ~60 s, that confirms report 01 2.5 and why caching must stay disabled.
7. **Cron invalidation:** add a `triggers.scheduled` entry in a spike config, deploy, trigger it, and confirm the direct `next/cache` import (`cron=direct` path in `worker-entry.ts`) again does nothing while the `handler.fetch` path works. The local trigger URL is `/cdn-cgi/local/scheduled?cron=direct|handler`; deployed, use the dashboard or `cf` trigger command.
8. Cleanup (human): `drop table spike_hyperdrive_probe;` and delete the spike Hyperdrive config (`cf hyperdrive delete <id>`) and the scratch Worker.

## Report 01 corrections

1. **Versions (header):** installed are vinext 1.4.0, `@vinext/cloudflare` 1.3.0, response-store 1.1.4 (not 1.3.1 / 1.2.1 / 1.1.3).
2. **1.2/1.3, verified:** `process.env` has text and secret bindings (and `CF_VERSION_METADATA`) in both dev and the production preview; undeclared `.env.local` keys do not leak in; `env` from `cloudflare:workers` can be read at module scope. The "not tested" qualifier can be dropped.
3. **1.6, the local Hyperdrive string:** correct, with details the report lacked: the variable works from a dotenv file (tested via `.env.development`), `vp dev` throws without it, `vp build` does not, and **`vp test` also throws without it** because vite-plus loads the whole `vite.config.ts` (fixed by skipping the plugins under `VITEST`). The report's statement that in local mode "the Worker talks to the database directly" is true in effect, but `env.HYPERDRIVE.connectionString` is a fake `<hash>.hyperdrive.local:5432` URL, not the real one.
4. **`vp test` also ran the 25 test files in `.references/jknm`** (11 failed). Add `exclude` for `.references` (done in `vite.config.ts`).
5. **2.2, "Pool created per request: UNVERIFIED against Hyperdrive":** works against local Hyperdrive and the Supabase pooler (reads, `Promise.all`, transactions, contention). Not verified against deployed Hyperdrive. Added hazard: the Pool/Client must not be closed when `fetch` returns, because production RSC streams Suspense content after that (reproduced: `Cannot use a pool after calling end on the pool`).
6. **2.3, the proxy:** works as sketched in a route handler, a Server Action, an `unstable_cache` callback, a Suspense child and `scheduled`. Pglite is assignable to `PgDatabase<PgQueryResultHKT, typeof schema>` without a cast. Two typing notes absent from the report: `db.execute()` returns `unknown` with the base HKT (cast to `pg`'s `QueryResult` when needed), and the pre-commit hook enforces type-aware lint (`vp check`) so these surface at commit time.
7. **2.5/2.7:** `cf hyperdrive create` has **no caching flag** (the report guessed `--caching-disabled` on create). Use `cf hyperdrive update <id> --caching-disabled` (also on `replace`). `DATABASE_URL` is the 6543 transaction pooler (confirmed); session pooler 5432 reachable, direct host not reachable from an IPv4-only machine.
8. **4.1, confirmed exactly** (digest only in production, `Minified React error #441` on the client, real error logged server-side; dev leaks message and stack). **4.2, confirmed** for `updateTag` (read-your-writes), `revalidateTag` without profile (hard purge, but a type error with `vinext/types`), `revalidateTag(tag, "max")` (SWR), `updateTag` outside an action (throws), and Date serialization. The report's "UNVERIFIED whether `revalidateTag` has a valid context in `scheduled`/`queue`" is now answered: **it does not work** when `next/cache` is imported from the Worker entry (silently no-ops); it works only when routed through the vinext handler. Also `/cdn-cgi/handler/scheduled` (what newer wrangler docs use) 404s here; the working local trigger is `/cdn-cgi/local/scheduled`.

Still unverified after this spike: Hyperdrive pooling and pinned connections under concurrency, deployed Workers Cache and Durable Object tag behavior, Hyperdrive IPv6 reachability of the Supabase direct host, `queue` handler composition, `NEXT_PUBLIC_*` inlining into the server bundle, and `.env.local` (as opposed to `.env.development`) supplying the local Hyperdrive string.

## Appendix: deployed verification (2026-10-31)

Run against production Supabase, scratch table only, on scratch resources (Workers `jknm-spike-tmp` and `jknm-spike-tmp-response-store`, an R2 bucket, two Hyperdrive configs), guarded by a secret `x-spike-token` header. **Everything was deleted afterwards** (Workers, bucket, both Hyperdrive configs, scratch table; confirmed by listing). A pre-existing `jknm-cloudflare` Worker exists in the account; it was not touched.

| Check                                                                                                         | Result                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hyperdrive create + `cf hyperdrive update <id> --caching-disabled`                                            | works; `create` has no caching flag                                                                                                                                                                                                                                     |
| Transactions (commit, rollback, savepoint, `FOR UPDATE` contention) via Hyperdrive, `pool` and `client` modes | **PASS**: `afterCommit` 1, `afterRollback` 1, `afterSavepoint` 2, `afterContention` 4 (no lost update), B got the lock ~430 ms after A                                                                                                                                  |
| Origin = Supabase **session pooler 5432**, 20 parallel x 40                                                   | **partial failure**: about half the requests failed with `EMAXCONNSESSION ... max clients are limited to pool_size: 15` (plus a few Worker 1101s). The Hyperdrive default `origin_connection_limit` is 20, above Supabase's 15                                          |
| Origin = Supabase **direct host** `db.<ref>.supabase.co:5432` via Hyperdrive                                  | **PASS**: reachable from Hyperdrive (it was not from the IPv4-only dev machine); 40/40 requests OK at concurrency 20                                                                                                                                                    |
| Cache test, Hyperdrive caching **disabled**                                                                   | **PASS**: no invalidation stays stale; `updateTag` and one-arg `revalidateTag` give read-your-writes; `revalidateTag(tag, "max")` is SWR; `updateTag` outside an action throws; outside `revalidateTag` works                                                           |
| Cache test, Hyperdrive caching **enabled** (`--caching-max-age 60`)                                           | **confirms report 01 2.5**: after bump + `revalidateTag`(1 arg) the route re-read returned the old counter (db 9, route 8); the same for the outside `revalidateTag` calls. `updateTag` happened to read fresh in that run, so do not rely on it. Keep caching disabled |
| Cron (`scheduled` + `next/cache`) deployed                                                                    | not run; already shown locally to no-op when `next/cache` is imported from the entry                                                                                                                                                                                    |

Conclusion for the handoff: **use the direct host as the Hyperdrive origin** (it works from Hyperdrive and avoids Supabase's 15-client session pool limit); if the session pooler is used, set `origin_connection_limit` at or below 15. Keep Hyperdrive caching disabled.
