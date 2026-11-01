# Spike: better-auth over the request-scoped db, and Google Admin directory via fetch + jose

Run 2026-10-31/11-01 on branch `spike/auth` (from `spike/db-cache`). Labels: **measured** (I ran it), **derived** (follows from measured facts or source), **UNVERIFIED**. Source paths are in `~/code/repos/better-auth/better-auth` (packages/better-auth 1.7.14, installed `better-auth ^1.7.14`) and `~/code/repos/cloudflare/cloudflare-docs`. Versions otherwise as in report 03.

## Summary of verdicts

| #   | Question                                               | Verdict                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | One `betterAuth()` per isolate over the ALS `db` proxy | **PASS** (pglite, `vp dev`, production build + `vp preview`). Recommended: it keeps `import`-style call sites and costs nothing per request.                                                                                                                                 |
| A2  | Per-request `betterAuth()` over the concrete db        | **PASS** too. Construct cost 0-3 ms. Not needed; keep only if you want zero ALS reliance inside auth.                                                                                                                                                                        |
| A3  | `account.issuer` in production                         | **Present and NOT NULL, with unique index `account_issuer_account_id_uidx`.** The new schema omits it, so sign-in on the new site fails until the DB is changed. No duplicates on (provider_id, account_id). Counts: user 3, session 17 (2 live), account 3, verification 0. |
| A4  | Cookies                                                | **Not `Secure` by default on Workers** (NODE_ENV is absent from `process.env`). Set `advanced.useSecureCookies` explicitly. Host-only, `SameSite=Lax`, `HttpOnly`.                                                                                                           |
| A5  | `backgroundTasks` / `waitUntil`                        | `import { waitUntil } from "cloudflare:workers"` is correct (docs + deployed check). Optional; nothing in login/session paths needs it.                                                                                                                                      |
| A6  | `/api/auth/[...all]` in Vinext                         | **PASS**: `export const GET/POST = (req) => getAuth().handler(req)`. Sign-in/social, sign-out (DB write), CSRF origin check (403) all behave.                                                                                                                                |
| B   | Admin SDK `users.list` with `fetch` + `jose`           | **PASS** in Node, local workerd and a deployed scratch Worker. Same 101 users, identical field digest as `googleapis`. CPU 3-6 ms per full sync deployed. No domain-wide delegation `sub` is used (or needed) by the old code.                                               |

Changes to handoff decisions are listed at the end.

## Evidence: Task A

### A0. Code (all under `lib/spike/auth/`, deletable)

- `tables.ts`: `createAuthTables(schemaName?)`, the four better-auth tables ported from `.references/jknm/src/server/db/schema.ts:61-174` without `issuer` and without the `account_issuer_account_id_uidx` index. Property names kept (the adapter indexes tables by them; old schema comment). The optional schema name exists only so dev routes ran against a scratch Postgres schema.
- `auth.ts`: `createAuth({db, tables, secret, google..., allowedHosts, waitUntil?, useSecureCookies?})`, a pure factory (no `cloudflare:workers`, no `next/*`). Ported unchanged: Google provider with the custom `getUserInfo` (`decodeJwt` from `jose` + `is_allowed_sign_in`), `account.accountLinking {enabled, trustedProviders:["google"]}`, `baseURL.allowedHosts`.
- `sign-in-gate.ts`, `session-shape.ts` and their tests copied verbatim (only the `WORKSPACE_EMAIL_DOMAIN` import inlined and the test import changed to `vite-plus/test`).
- `instances.ts` (the only file touching `cloudflare:workers` env): `getAuth()` (isolate singleton, adapter gets the ALS `db` proxy), `getRequestAuth()` (memoised per concrete db in a `WeakMap`).
- Routes: `app/api/auth/[...all]/route.ts`, `app/spike/auth/session/route.ts` (`?mode=singleton|request`), `app/spike/auth/page.tsx` (Server Component using `headers()` from `next/headers`), `app/spike/auth/cookie/route.ts`.
- Tests: `auth.pglite.test.ts` (9 tests), `vp test`: 5 files, 38 tests pass (**measured**).

### A1/A2. Adapter property access on the proxy

Source: `packages/drizzle-adapter/src/drizzle-adapter.ts`. What the adapter touches on `db`: `db.insert/delete/update/select`, `db.query[model].findFirst/findMany` (only when `joins` is on), `db.transaction` (only when `config.transaction` is true; default `false`, line ~1255), and `db._.fullSchema` / `db._.schema` (lines 191, 216, 1242, 1280). All are lazy, and `db._` is only read when `config.schema` is not passed (lines 216, 1242) or for join relation keys (191). We pass `schema`, so `betterAuth(...)` can be **constructed outside any `runWithDb` scope** (construction never touches `db`). **Measured**: pglite test constructs the singleton with `db` (the proxy) at test scope, then calls it only inside `runWithDb`.

Pglite results (`lib/spike/auth/auth.pglite.test.ts`, all **measured**):

- `auth.api.getSession({headers})` with a cookie signed by HMAC-SHA256 (`encodeURIComponent(token + "." + base64(sig))`, cookie name `better-auth.session_token`) returns the seeded user; `to_app_session` gives `{user:{id,name,email,image}, expires: ISO}`.
- Same singleton resolves the db **per scope**: with two pglite instances, the cookie resolves in the seeded one and returns `null` in the empty one.
- 20 concurrent `runWithDb` scopes alternating two dbs on one singleton: results alternate exactly (no cross-talk).
- Per-request construction over `getDb()` also works.
- Rejected: wrong secret, tampered signature, expired session, unknown token (all `null`).
- Write path via the proxy: `POST /api/auth/sign-out` deletes the session row (and CSRF origin check passes with an `origin` header).
- `db.transaction` and `typeof db.query === "object"` work through the proxy. better-auth itself does not use transactions with default options.
- Account rows insert/select without `issuer`.
- Hazard (**measured**): with `baseURL: {allowedHosts}` a `getSession` call whose headers carry no host throws `APIError 500 "Dynamic baseURL could not be resolved for this direct auth.api call. Pass headers: request.headers (or request) to the call, or add fallback"`. Request paths always have a host; a Cron/Queue handler calling `auth.api.*` would not. Add `baseURL.fallback` if any non-request code calls auth.

`vp dev` and production build + `vp preview` (workerd), through the custom Worker entry and the Supabase transaction pooler (**measured**):

- `GET /spike/auth/session` with the cookie, both modes, returns the session; no cookie returns `session: null`. `GET /spike/auth` (Server Component, `await headers()`) renders it. `GET /api/auth/ok` returns `{"ok":true}`.
- Construct time: singleton 2-3 ms on first use, then 0; per-request 0-1 ms. `getSession` 240-410 ms, which is the round trip from this machine to Frankfurt through the pooler, not representative of Hyperdrive.
- `POST /api/auth/sign-in/social {provider:"google"}` returns the Google authorize URL, `redirect_uri` built from the request host (`http://localhost:<port>/api/auth/callback/google`), and writes a `verification` row (7 rows seen in the scratch schema at the end). No Google flow was run.
- `allowedHosts: ["localhost:*", "*.workers.dev"]` wildcards worked for `localhost:5201/5203/5211` and the deployed `*.workers.dev` host.

### A1-bis. Production build hazard (rolldown chunk cycle)

First production build had `lib/spike/schema.ts` re-exporting the auth tables from `./auth/tables`. `vp preview` then died at Worker start: `Uncaught TypeError: Class extends value undefined is not a constructor or null at _next/static/tables-*.js` (**measured**). Inspecting the output (`.cloudflare/output/v0/workers/default/bundle/_next/static`) showed the chunks `drizzle-orm`, `tables`, `schema`, `instances` importing each other (`drizzle-orm-*.js` imports `./schema`, `./instances` and `./tables`; `tables` imports `drizzle-orm`), so a drizzle class was evaluated before its base class. Removing the `schema.ts -> auth/tables.ts` import (the pglite test now builds `{...schema, ...createAuthTables()}`) removed the cycle and the build worked (**measured**). Root cause in rolldown's chunking is **UNVERIFIED**. Port implication: keep one `server/db/schema.ts` module that holds all tables (as the old repo does), do not split table definitions across files that other modules import from different directions, and run `vp build && vp preview` early after adding better-auth. Dev mode (unbundled) did not show it.

### A3. Production `account` table (read-only, **measured**)

`scripts/spike-auth-prodcheck.mjs` (SELECTs inside `BEGIN READ ONLY`; counts and schema facts only):

- `account` columns: `id, user_id, account_id, provider_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, scope, id_token, password, created_at, updated_at, issuer` (`issuer varchar NOT NULL`, last).
- Indexes: `account_issuer_account_id_uidx`, `account_pkey`, `account_user_id_idx`.
- Duplicate groups on (provider_id, account_id): 0. Null issuer: 0. provider ids: `google` x3.
- Rows: user 3 (all `@jknm.si`, all email_verified), session 17 (2 unexpired), account 3, verification 0. `session` and `verification` columns match the ported schema exactly; `user` too.

**Derived** (blog `docs/content/blogs/1-7-account-schema.mdx:33-35`: 1.7.3+ does not write `issuer`, "databases that still require it can reject new accounts"; schema validation compares the Drizzle object only, `docs/content/docs/concepts/database.mdx:128-130`, so it will not flag the live DB): with the ported schema, every first-time or re-link sign-in on the new site would fail on `issuer NOT NULL`. Existing sessions are unaffected. The old Vercel site (better-auth 1.7.1) writes `issuer` and shares this DB until cutover. Safe order:

1. Now (works for both sites): `ALTER TABLE account ALTER COLUMN issuer DROP NOT NULL;` Leave the unique index: it is on `(issuer, account_id)`, NULLs are distinct in Postgres, so the new site's null-issuer rows cannot collide, and the old site keeps whatever it relies on.
2. After cutover: `DROP INDEX account_issuer_account_id_uidx; ALTER TABLE account DROP COLUMN issuer;` (dropping the column also drops the index). I ran none of this.

### A4. Cookies on Workers

- Source `packages/better-auth/src/cookies/index.ts:44-77`: Secure resolves as `advanced.useSecureCookies` > dynamic `baseURL.protocol` > static `baseURL` scheme > `isProduction` (`NODE_ENV === "production"` read from `process.env` at module load, `packages/core/src/env/env-impl.ts:49-52`). With `baseURL: {allowedHosts}` and no `protocol`, only the last applies.
- **Measured** in the deployed scratch Worker (https): `process.env` keys were only the three declared secrets, no `NODE_ENV`; default `Set-Cookie: better-auth.state=<v>; Max-Age=300; Path=/; HttpOnly; SameSite=Lax` (no `Secure`). With `useSecureCookies: true`: `__Secure-better-auth.state=<v>; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax`. Local `vp dev` and `vp preview` identical to the default. (`process.env.NODE_ENV` in route code reads `"production"` in a build because the bundler replaces it statically; better-auth reads the runtime object.)
- No `Domain` attribute: host-only, so `jknm.si` and `www.jknm.si` sessions are separate (as report 01 5.4).
- Recommendation: `advanced.useSecureCookies: true` in all deployed environments. For `vp dev` over `http://localhost`, drive it from a binding (e.g. `useSecureCookies: env.ENVIRONMENT !== "development"`); Chrome/Firefox accept `Secure` cookies on localhost over http, Safari does not (**UNVERIFIED**, browser behaviour not tested). The prefix change also renames the cookie to `__Secure-better-auth.session_token`: existing logins on the old site use the unprefixed name and are not valid on the new origin anyway.

### A5. `waitUntil`

- Cloudflare: `import { waitUntil } from "cloudflare:workers"` (changelog `src/content/changelog/workers/2025-08-08-add-waituntil-cloudflare-workers.mdx`; same semantics as `ctx.waitUntil`, 30 s limit after the response, `workers/runtime-apis/context.mdx:223-225`). better-auth docs show exactly this (`docs/content/docs/reference/options.mdx:735-747`). It is correct; report 01 5.2 marked it UNVERIFIED and can be closed.
- **Measured**: the import resolves in the deployed Worker and in `vp dev`/`vp preview` (`typeof waitUntil === "function"`); `lib/spike/cf-env.ts` re-exports it so other code stays Node-importable.
- What it is used for (grep `runInBackgroundOrAwait` in packages/better-auth/src): rate-limit row pruning (`api/rate-limiter/index.ts:232`), verification/reset emails, update-user emails, sign-in/sign-up post hooks. Without a handler better-auth awaits the work inline (`context/create-context.ts:408-428`). **Measured**: `getSession` and `sign-out` scheduled 0 background tasks. For jknm (Google only, no email flows) it is optional; the docs warn it introduces eventual consistency (`options.mdx:714-716`).

### A6. Other notes

- Route: `toNextJsHandler(auth)` is not needed; `auth.handler(request)` is the Workers form (`docs/content/docs/installation.mdx:329-346`) and works as a Vinext route handler.
- `nodejs_compat` (already set) provides `AsyncLocalStorage` which better-auth needs (`installation.mdx:349`).
- Hyperdrive: not exercised here (local Hyperdrive proxies to the Supavisor pooler, see report 03 sections 3-4). Auth reads must go to the cache-disabled config (report 01 2.5).

## Evidence: Task B (Admin SDK with `fetch` + `jose`)

### B0. What the old code does (`.references/jknm/src/server/author/sync_members.ts`)

`google.auth.getClient({credentials, scopes:[".../admin.directory.user.readonly"]})` with `JKNM_SERVICE_ACCOUNT_CREDENTIALS` = base64(service-account JSON), **no `subject`**, then `admin.users.list({customer: "C049fks0l", maxResults: 200, pageToken})` in a `nextPageToken` loop, trimming `givenName`/`familyName`, hard errors on missing names / missing or duplicate ids. `JKNM_WORKSPACE_ID` in `.env.local` equals that hardcoded customer id (checked without printing it).

Credential facts (**measured**, structure only): JSON keys `type, project_id, private_key_id, private_key, client_email, client_id, auth_uri, token_uri, auth_provider_x509_cert_url, client_x509_cert_url, universe_domain`; `type: service_account`; env value is 3192 chars of base64; decoded `private_key` is PKCS8 (`-----BEGIN PRIVATE KEY-----`), 28 real newlines, ends with a newline, zero literal `\n` sequences.

### B1. Module: `lib/spike/google-directory.ts` (no runtime-specific imports)

`parseServiceAccount(b64 or raw JSON)`, `getAccessToken(sa, {scope?, sub?})`, `listMembers(token, {customer, maxResults, onPage})`, `fetchGoogleMembers(...)`. Flow: `importPKCS8(pem, "RS256")` -> `SignJWT({scope}) .setIssuer(client_email).setAudience(token_uri).setIssuedAt().setExpirationTime(+3600)` -> `POST token_uri` form `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=...` -> `GET https://admin.googleapis.com/admin/directory/v1/users?customer=&maxResults=&pageToken=` with `Authorization: Bearer`. `sub` is optional and unused by default (the old code never impersonated). Hard-error rules copied from the old function. 6 unit tests (`google-directory.test.ts`, mocked `fetch`, generated RSA key): JWT verified with the public key (alg, typ, iss, aud, scope, exp-iat = 3600, no `sub`), `sub` only when requested, literal-`\n` normalisation, token error mapping, pagination + trimming, duplicate/missing-name/API errors.

### B2. Comparison with `googleapis` (Node, same credentials, **measured**)

`scripts/spike-google-node.mjs` (old logic copied into the script; `googleapis@176`, `google-auth-library@11` installed in `/tmp/old-google`, not in the repo):

- Old: 101 users, 1 page, 881-980 ms, digest `17b75d15d0b9` (sha256 prefix over sorted `[id, first, last, email, image]`).
- New, `maxResults=200`: 101 users, 1 page, 880 ms, **same digest**, ids equal; fields `google_id, first_name, last_name, email, image`. Masked sample: id `1012…`, email `ad***@jknm.si`, no image. Timings: importKey 0.2-2.1 ms, sign 0.8-1.3 ms, token exchange 57-184 ms.
- New, `maxResults=5`: 21 pages (5 x 20 + 1), 8.0 s total (about 380 ms per page), same digest. 101 users is half of one 200-user page, so pagination is untested by real data at the default size; the `maxResults=5` run is the proof.

### B3. workerd and deployed (**measured**)

- Local workerd (`vp dev`, `app/spike/google/route.ts`, secret bindings read from `.env.local`): same 101 / digest. RS256 via `importPKCS8` (WebCrypto) works. `performance.now()` is frozen between I/O in workerd, so import/sign show 0-1 ms; only the I/O timings are meaningful (token 70-218 ms, list 449-655 ms).
- Deployed scratch Worker `spike-tmp-auth-google` (secret `x-spike-token` header, secrets via `cf deploy --secrets-file`, deleted afterwards): 403 without the token; with it same 101 / digest. Token exchange 36-99 ms, `users.list` page 448-491 ms, wall 484-593 ms (HTTP 0.62-0.73 s from here). 21-page run 7.8 s.
- **CPU** (Workers Observability invocation log, `cf o11y telemetry query --view invocations`, field `$workers.cpuTimeMs`): **3 ms, 3 ms, 6 ms** for single-page syncs (wall 487-593 ms), **23 ms** for the 21-page run (wall 7809 ms). Includes RS256 signing, two TLS fetches, JSON parse, and my SHA-256 digest. A 21-page run is still 23 ms.
- Bundle: the probe Worker (this module + `jose` + probe) was 33.5 KiB / 10.2 KiB gzip, startup 6 ms (`cf deploy` output). `googleapis` is not needed.

### B4. Errors and the PEM format (Node, **measured**, `scripts/spike-google-errors.mjs`)

- `private_key` as stored (real newlines): ok. Without trailing newline, with CRLF line endings, or with no newlines at all: `importPKCS8` accepts all four (jose strips whitespace).
- Literal two-character `\n` instead of newlines (a secret pasted as escaped JSON): raw `importPKCS8` throws `SyntaxError: Found a character that cannot be part of a valid base64 string`. `parseServiceAccount` normalises `\\n` -> newline, and that case then succeeds (also in the deployed Worker with `?breakKey=literal-n`). Storing the credentials as base64(JSON), as the old repo does, avoids the question entirely, and `cf` secrets/`--secrets-file` carried the 3.2 kB value intact.
- Token endpoint, nonexistent `sub`: `HTTP 400 invalid_grant: Invalid email or User ID`. So DWD impersonation is a different mode than what works today; if it were ever needed, an admin email must be supplied. I did not impersonate a real user.
- Token endpoint, unknown scope: `HTTP 200` with no `access_token` (the module raises `token failed: HTTP 200 ?`). Check for the field, not only `res.ok`.
- `users.list` wrong customer id: `400 Bad Request`; garbage bearer: `401 UNAUTHENTICATED`. Both surfaced as `GoogleApiError{step,status,reason}`.
- Token caching is not implemented (tokens live 3599 s; a sync is a rare admin action). If it is ever called often, cache `{token, exp}` per isolate.

## Hazards and cleanup facts

- **I leaked a session setting into the production pooler.** My first prod check ran `SET default_transaction_read_only = on` at session level over the Supavisor transaction pooler; it persisted on the pooled backend, and my next connection (the scratch-schema script) failed with `cannot execute DROP SCHEMA in a read-only transaction`. I reset it on that connection and then opened 12 fresh connections, all `off` (one backend pid). For a few minutes, writes routed to that backend could have failed. The script now uses `BEGIN READ ONLY` (transaction-scoped). Lesson for the port: session state through a transaction pooler leaks between clients, which is the same reason Hyperdrive documents "session state changes" as unsupported (report 01 2.4); never `SET` without `LOCAL`.
- Resources: scratch Postgres schema `spike_tmp_auth` created and **dropped** (`to_regnamespace` = null afterwards). Production counts before/after identical (user 3, session 17, account 3, verification 0). Scratch Worker `spike-tmp-auth-google` deleted; the Worker name lists before and after are identical (`ace-roster-web`, `jknm-cloudflare`, `jknm-cloudflare-response-store`, `markdowner`, `spike-tmp-plumb-*`, `spike-tmp-search-*`). No Hyperdrive config, DNS or other resource created. The secrets file (random token plus credentials) was shredded; the credentials never appeared in output or in git (`.env.local` is symlinked into the worktree and ignored).
- Dev servers and workerd processes started by this spike were killed.

## Changes to handoff decisions

1. **Auth construction.** The handoff says "Build auth per request over the request-scoped db". Both work; prefer one `betterAuth()` per isolate over the ALS `db` proxy (construct once, never touches `db` until a request). Per-request is an equivalent fallback.
2. **`account.issuer`.** Not "if production has the column": it **does** have it, `NOT NULL` plus the unique index. Do `ALTER COLUMN issuer DROP NOT NULL` before the new site takes sign-ins; drop index and column only after the old Vercel site is gone (it still writes `issuer` and shares this DB). Duplicate check is clean.
3. **Secure cookies are not automatic on Workers**; set `advanced.useSecureCookies` (the handoff/report 01 5.4 assumed "Secure by default in production").
4. **`waitUntil` import** is `cloudflare:workers` (closes the UNVERIFIED in report 01 5.2).
5. **Member sync** needs no domain-wide delegation `sub`: the service account lists users directly, as the old code did. Replace `googleapis`/`google-auth-library` with `lib/spike/google-directory.ts` as is; CPU is ~3-6 ms.
6. **Build check after adding better-auth**: a table-definition split caused a runtime chunk cycle in the production bundle that dev never shows (see A1-bis).
7. Calls to `auth.api.*` outside a request (Cron/Queue) need `baseURL.fallback` or will 500.

## Reproduce

- `vp install`, then `bash scripts/spike-env.sh vp test run` (pglite, no DB needed; `vp test run` alone also works).
- Dev: `BETTER_AUTH_SECRET=<random> SPIKE_TOKEN=x bash scripts/spike-env.sh vp dev`; create the scratch schema first with `node scripts/spike-auth-scratch.mjs up` (writes a signed cookie to `/tmp/spike-auth-cookie`), drop it with `... down`.
- Prod facts: `bash scripts/spike-env.sh node scripts/spike-auth-prodcheck.mjs` (read-only).
- Directory: `node scripts/spike-google-inspect.mjs` (structure only), `GOOGLE_OLD_DIR=<dir with googleapis> node scripts/spike-google-node.mjs`, `node scripts/spike-google-errors.mjs`.
- Scratch Worker: `scripts/spike-tmp-auth-worker/` needs `ln -s ../../node_modules scripts/spike-tmp-auth-worker/node_modules` (cf looks for the vite plugin next to its `package.json`; remove the link afterwards or `vp test` scans it), then `cf deploy --secrets-file <json>` from that directory and `cf workers delete spike-tmp-auth-google --force`.
- Non-spike changes worth keeping: `vite.config.ts` `test.exclude` now uses `**/node_modules/**`.
