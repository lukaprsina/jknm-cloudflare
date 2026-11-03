# Port order

Spikes 03-07 retired the risk step. What is left is porting, plus the few unknowns listed per step. Details: `00_HANDOFF.md`, `research/`.

## 0. Done: risk spikes

Hyperdrive (direct host, caching off), Server Actions (`Result` needed), cache tags, env, auth seam, Google via fetch+jose, search on Paid, queue/cron, bundle. Nothing blocks starting.

## 1. Foundation

- Env: `cloudflare:workers` env; only declared bindings reach `process.env`. `NEXT_PUBLIC_*` must exist in CI.
- `server/db/schema.ts` (one module), `pg` + ALS `db` proxy via Hyperdrive, pglite tests.
- Custom worker entry: `fetch` + `scheduled` + `queue`, guarded internal revalidate route.
- Drizzle config, pnpm patches. Drop the `zbsearch` override.

**Done (branch `port/foundation`):**

- Env: `server/env.ts` is the only `cloudflare:workers` importer (zod, lazy). The entry uses the generated `Env` type. `DATABASE_URL` is drizzle-kit only and stays undeclared.
- `NEXT_PUBLIC_*` in CI: there is no CI yet (the old repo had none; Vercel built it). Set the variables in the Workers Builds environment when deploys are wired up; noted in `.env.example`.
- Pool per invocation: kept as is. `pg.Pool` opens no connection until the first query, so `scheduled`/`queue` stubs cost nothing, and the gate 404s return before `scoped`. Idle clients close after `pg`'s default 10 s. Deployed spike 03 (appendix) already ran this pattern (`pool` mode, direct host, caching off) at concurrency 20 with 40/40 OK. Never `end()` it. A fresh deployed load test belongs to the cutover checks.
- Style cleanup: stale `schema.ts` comment, route path as one constant (`REVALIDATE_PATH`), gate `headers()` is a method. Left alone on purpose: repeated column code in `schema.ts` (helpers would add churn), table-name casing (matches the old DB), `revalidate_tags` in the entry (no caller yet).
- pnpm patches: deferred to step 6. pnpm fails on a patch for a package that is not installed, so copy `patches/@editorjs%2Feditorjs@2.31.6.patch` and add `patchedDependencies` together with `@editorjs/editorjs`. The `zbsearch` override was never carried over.
- Early on purpose, ahead of their steps: `BETTER_AUTH_SECRET` (3), `jose` (3, 6), the `QUEUE` binding and daily cron (7, 8). `scheduled` and `queue` are stubs.

## 2. Pure domain core

Copy `server/article/*`, `server/author/*` (no Google sync), `lib/cache-policy.ts` and tests. `vp test` green. Cache adapters use `updateTag` / hard expiry, never `"max"`.

**Done (branch `port/domain-core`):** rewritten, not copied; the code and tests are the spec. Decisions the code does not show:

- Seams are `create_articles({ db, emit })` and `create_authors({ db, emit })`. Search (step 7) hangs off `emit`, so lifecycle code never learns about it.
- Not ported: Algolia, `get-article` (step 4), `sync_members` and its diff (step 6), the zod validators (step 3, action layer), slug-request resolution and visibility (step 4).
- TanStack Query is dropped; `cache-policy` has no `query_keys`.
- `title_to_slug` is pinned to production by `lib/title-to-slug.golden.json` (published titles and their stored slugs, captured 2026-11-02). Known gaps against the old function, on input real titles do not contain: numeric and named HTML entities, and `<script>`-style or malformed tags. Fix when step 4 picks the HTML sanitizer, and let slug, meta title and TOC share one `strip_html_to_text`.
- Not tested here: `FOR UPDATE` contention on supersede-publish (pglite has one connection) and the real `updateTag` adapter. Both belong to a deployed check.

## 3. Auth

- better-auth per isolate, `useSecureCookies`, `baseURL.fallback`, no `issuer`.
- **Before first sign-in:** `ALTER COLUMN issuer DROP NOT NULL` on prod `account`.
- `/api/auth/[...all]`, `/prijava`, `action(schema, handler)` returning `Result`.
- Human: Google OAuth redirect URI (not spiked). Origins: `localhost:3000` and `https://jknm.org` (apex only, no `www.jknm.org`; remove the stray www entry in Google Console). `allowed_hosts`: `localhost:*`, `jknm.org`, `jknm.si`, `www.jknm.si`.
- Adopt `better-result` for new code from here (`Unauthorized`, `InvalidInput`). `action` flattens to a plain `{ ok, data | error: { code, message, fields? } }` envelope; Result instances do not cross the Server Action boundary. Verify in Vinext (action + `Result.gen` on workerd) and add `better-result` to `refs.toml`. No backfill of step 2 here.

**Done (branch `port/auth`):** `server/auth/*`, `server/create-action.ts`, `server/action.ts`, `/api/auth/[...all]`, a bare `/prijava`. Decisions the code does not show:

- Seam is `create_auth({ db, ... })` (pure); `get_auth()` is the isolate singleton over the ambient `db` proxy. `secure_cookies` comes from the scheme of `NEXT_PUBLIC_DEPLOYMENT_ORIGIN`, so there is no environment binding. `fallback_origin` is that same origin: a host outside `APP_HOSTS` gets it, so a foreign `Host` header never reaches a redirect URI, and `auth.api.*` works in Cron/Queue.
- No `wait_until` option: nothing needs it, so better-auth awaits background work inline. Add it when a caller does (`waitUntil` from `cloudflare:workers`, re-exported via `server/env.ts`, the only importer).
- `get_session()` returns `Session | null` for pages; `action` turns null into `Unauthorized`. `ActionResult` is plain data (`unauthorized | invalid | failed`; `rule` arrives with step 6). Messages are Slovenian; a `failed` message is generic and the cause goes to `console.error`.
- Local Worker secrets come from `.dev.vars`, not `.env` (preview does not read `.env`). `.dev.vars` needs `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; deployed, set them with `cf`.
- Checked on the built Worker (`vp build` + `vp preview`): no chunk cycle, sign-in start builds the redirect URI from the host, `/prijava` shows the session from a signed cookie, `action` (incl. `Result.gen`) returns the expected plain results on workerd.
- Not checked: a real Google sign-in round trip, and an `action` invoked from a client (no action exists yet; step 6). Google redirect URIs are exact, per origin: add the port `vp dev` / `vp preview` actually uses.
- Still to do by hand before the first real sign-in: `ALTER TABLE account ALTER COLUMN issuer DROP NOT NULL;` on prod. A fresh backup is `scripts/backup-db.sh` (`~/.backups/jknm`).

## 4. Public read path

Layout/nav/footer, homepage keyset feed, `/novica/<slug>`, static pages, robots/sitemap/OG, `/si` redirects (tests already green in the old repo). Images need a custom loader or image Worker (`/_next/image` is local-only).

## 5. Media

R2 binding, Images, upload/ingest, `reconcile-media`. Bucket copy with superslurper is a cutover step. Open: upload size vs Worker body limit (decide from docs); no spike done.

## 6. Admin and editor

`/uredi`, EditorJS (works in dev and build; upload tools and save round-trip untested), lifecycle actions, `/preveri`, `/avtorji`, member sync (`fetch` + `jose`, ready).

Backfill `better-result` into `server/article/lifecycle-rules` here, when the first caller exists: one `RuleViolation` tagged error (`rule` field, `message`), mapped to `code: "rule"` by `action`. Leave `one` / `found` / `find_source` as throws (invariants, not expected failures).

## 7. Search

Plain-JSON zbsearch, stemmed `create()` + `load()`, q9 build in a Queue consumer (fingerprint skip) + daily cron, artifact `….bin` on an R2 custom domain with CORS. Add `author_desc`. Untested: the Queue consumer running the build.

## 8. Peripherals and cutover

Resend vs `cf email-sending` (undecided), sweep-stale-content cron, backups. `jknm.si` DNS cutover and Vercel removal are parked; build the site first.

## Still unresearched

Media upload path, Resend vs CF email, backups, multi-colo cache behaviour, R2 Cache Rule alternative, Queue-run search build. All are decide-while-porting, none blocks steps 1-4.

Each step gets a short "Done" note under its list when it lands; notes that span steps go at the bottom.

shadcn components are added in steps 4 and 6, one commit per `shadcn add`.
