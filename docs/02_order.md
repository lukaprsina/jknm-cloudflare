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
- pnpm patches: deferred to step 6. pnpm fails on a patch for a package that is not installed, so copy `patches/@editorjs%2Feditorjs@2.31.6.patch` and add `patchedDependencies` together with `@editorjs/editorjs`. The `zbsearch` override was never carried over.
- Early on purpose, ahead of their steps: `BETTER_AUTH_SECRET` (3), `jose` (3, 6), the `QUEUE` binding and daily cron (7, 8). `scheduled` and `queue` are stubs.

## 2. Pure domain core

Copy `server/article/*`, `server/author/*` (no Google sync), `lib/cache-policy.ts` and tests. `vp test` green. Cache adapters use `updateTag` / hard expiry, never `"max"`.

## 3. Auth

- better-auth per isolate, `useSecureCookies`, `baseURL.fallback`, no `issuer`.
- **Before first sign-in:** `ALTER COLUMN issuer DROP NOT NULL` on prod `account`.
- `/api/auth/[...all]`, `/prijava`, `action(schema, handler)` returning `Result`.
- Human: Google OAuth redirect URI (not spiked).

## 4. Public read path

Layout/nav/footer, homepage keyset feed, `/novica/<slug>`, static pages, robots/sitemap/OG, `/si` redirects (tests already green in the old repo). Images need a custom loader or image Worker (`/_next/image` is local-only).

## 5. Media

R2 binding, Images, upload/ingest, `reconcile-media`. Bucket copy with superslurper is a cutover step. Open: upload size vs Worker body limit (decide from docs); no spike done.

## 6. Admin and editor

`/uredi`, EditorJS (works in dev and build; upload tools and save round-trip untested), lifecycle actions, `/preveri`, `/avtorji`, member sync (`fetch` + `jose`, ready).

## 7. Search

Plain-JSON zbsearch, stemmed `create()` + `load()`, q9 build in a Queue consumer (fingerprint skip) + daily cron, artifact `….bin` on an R2 custom domain with CORS. Add `author_desc`. Untested: the Queue consumer running the build.

## 8. Peripherals and cutover

Resend vs `cf email-sending` (undecided), sweep-stale-content cron, backups. `jknm.si` DNS cutover and Vercel removal are parked; build the site first.

## Still unresearched

Media upload path, Resend vs CF email, backups, multi-colo cache behaviour, R2 Cache Rule alternative, Queue-run search build. All are decide-while-porting, none blocks steps 1-4.

Each step gets a short "Done" note under its list when it lands; notes that span steps go at the bottom.

shadcn components are added in steps 4 and 6, one commit per `shadcn add`.
