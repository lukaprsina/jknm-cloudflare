# Handoff: jknm Next.js/Vercel → Vinext/Cloudflare

Written 2026-10-28, before porting started. The old repo is checked out read-only at `.references/jknm` (pinned in `refs.lock` at `89d48c2`). The migration research is in `.references/jknm/docs/migration/` (`cloudflare-migration.md` is the main guide; also `plan.md` and `vercel-cpu-usage-investigation.md`). This file is a summary and some points differ from it; where they conflict, check the research.

Old-repo docs worth reading instead of re-deriving: `CONTEXT.md` (domain glossary), `docs/architecture.md` (stale in places, see below), `docs/adr/`, `docs/research/`. zbsearch decision and benchmarks: <https://github.com/lukaprsina/jknm/issues/45>.

## Decisions already made

- Vercel/Next.js → Cloudflare/Vinext (Workers Paid). Reason: hit Vercel's 4h Fluid CPU limit. Vercel Pro (€20) is bought for the duration of the refactor, so the site is no longer throttled.
- B2 → R2. Images go through Cloudflare Images (the `IMAGES` binding is already in `cloudflare.config.ts`). The old image pipeline is broken and gets dropped.
- Supabase + Drizzle stay, via Hyperdrive. No D1 (SQLite, transactions).
- Algolia → zbsearch (Orama fork, has Slovenian stemming).
- EditorJS stays. TipTap migration is parked.
- Tooling: `vp` (Vite+, pnpm) and the `cf` CLI. `cf cli search "<task>"` is the discovery entry point; don't walk `--help` trees.
- oRPC is dropped in favour of plain Server Actions (Vinext reportedly handles either, so this is a design choice, not a constraint).
- `@t3-oss/env-core` (or similar) for env. On Workers, check that `process.env` is populated under `nodejs_compat` at our compatibility date, or read from the `cloudflare:workers` env.
- Member sync stays: new users added to the Google directory must be synced in as authors. Replace `googleapis`/`google-auth-library` with `fetch` + `jose`.
- shadcn/ui on Base UI (`base-nova`; the old site is Radix, `default` style). Add components on demand with `shadcn add`, one commit per add so the pristine output stays diffable. `docs/shadcn-customizations.md` lists the six old components that were modified (`breadcrumb`, `carousel`, `command`, `navigation-menu`, `sheet`, `table`); re-apply those by hand if still wanted. Our own (non-ui) components get cleaned and redesigned, so don't just copy them.

## KEEP (port, improve while porting)

- Domain model and rules: `server/article/*` (`lifecycle-rules`, `reconcile-media`, `new-article`, `lifecycle`, `slug`, `get-article`, `article-queries`), the `articles` status-enum schema, `server/db/schema.ts`, `server/author/*`. These are already framework-agnostic; keep them and their pglite-based tests.
- `lib/cache-policy.ts` (pure event → invalidations mapping with a reachability test). It is a deep module. Only the adapters beneath it change, depending on what the Vinext cache preserves.
- better-auth (Google, `@jknm.si` gate, `sign-in-gate`, `session-shape`). Production DB needs the `account.issuer` migration for better-auth 1.7 (old `architecture.md` still says 1.6.27; `package.json` says 1.7.1). Keep `scripts/migrate/backfill-account-issuer.ts` if production hasn't been backfilled.
- Legacy redirects: `app/si/route.ts`, `app/si/[...path]/route.ts`, `lib/legacy-si-paths.ts`, `resolve-legacy-article-link` (old 2008 URLs still need 308/410 for SEO).
- `/novica/<slug>` response contract (see "`/novica/<slug>` response contract" in old `architecture.md`).
- `media_to_articles` reconciliation, content-addressed (sha256) media, `gradivo.jknm.org` as the media origin. Existing `content_json` has those URLs baked in, so copy the bucket to R2 and repoint the custom domain; no content rewrite.
- **`scripts/sweep-stale-content.ts` is not a migration script.** It clears orphaned media (48h) and `deleted` articles past their grace window. Port it as a Cron Trigger.
- `scripts/backup-db.ps1`-style backups, if still wanted.
- Contact form + Resend (optional: `cf email-sending` exists now).
- Tailwind v4, EditorJS tools and patch (`patches/@editorjs%2Feditorjs@2.31.6.patch`), `nuqs`, `react-hook-form` + zod, `lucide-react`, `motion`, `cmdk` and similar UI deps, as needed.
- pnpm override for `zbsearch: 4.0.0` (the `@zbsearch/plugin-*` packages publish an unresolved `workspace:*` dependency).

## REPLACE

| Old                                                                                                          | New                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| oRPC `.actionable()` procedures (`server/orpc/*`, `lib/orpc-action.ts`)                                      | One small `action(schema, handler)` helper: session gate, zod parse, call the business function, return a `Result` (not a throw, because production Next redacts thrown messages; verify Vinext behaves the same). No interface layer: one adapter means a hypothetical seam. Test the business functions, not the actions.                                                                          |
| Algolia + InstantSearch + sync/diff/repair (`sync-algolia*`, `lib/algoliasearch.ts`, `use-infinite-algolia`) | zbsearch **client-side**: BM25, `seqproto` format, ~1.4 MB brotli, ~240 ms restore, <10 ms search (issue #45). The index is derived from Postgres and built when the published set changes, then served as a static artifact (R2 or assets). Six replicas become `sortBy`. Risk to measure: indexing all ~700 articles inside one Worker request. QPS plugin is broken in persistence; don't use it. |
| B2 / `@aws-sdk/*` / `b2-js` / `lib/s3-utils.ts` / `lib/s3-publish.ts`                                        | R2 binding (or S3-compatible presign if direct browser upload is needed).                                                                                                                                                                                                                                                                                                                            |
| `sharp`, `image-loader.js`, `next/image`                                                                     | Cloudflare Images binding.                                                                                                                                                                                                                                                                                                                                                                           |
| `unstable_cache` + `revive-cache-dates.ts`                                                                   | Vinext / `@cloudflare/workers-response-store` cache (already wired in `cloudflare.config.ts`). Needs a smoke test.                                                                                                                                                                                                                                                                                   |
| `use-toast` / `toaster` (301 lines)                                                                          | sonner.                                                                                                                                                                                                                                                                                                                                                                                              |
| Three pagination approaches                                                                                  | See "Pagination" below.                                                                                                                                                                                                                                                                                                                                                                              |
| `googleapis`, `google-auth-library`                                                                          | `fetch` + `jose` for the Admin SDK directory call.                                                                                                                                                                                                                                                                                                                                                   |
| `/api/wake_supabase` + `vercel.json` cron                                                                    | Drop if Supabase is on a paid plan; otherwise a Cron Trigger.                                                                                                                                                                                                                                                                                                                                        |
| Biome + ESLint + Prettier                                                                                    | `vp check` (oxlint/oxfmt).                                                                                                                                                                                                                                                                                                                                                                           |
| Vitest                                                                                                       | `vp test` (pglite for DB tests).                                                                                                                                                                                                                                                                                                                                                                     |

### Pagination: pick one

- Homepage feed is the only genuinely server-paged list: keep the Postgres keyset cursor (the hand-written one), drop `drizzle-cursor`/`drizzle-pagination`.
- `/arhiv` slices the in-browser zbsearch results. `/avtorji` and `/preveri` load whole lists (a few hundred rows) and paginate in memory.
- Proposed (not decided): remove TanStack Query entirely. After oRPC it is used in three places (homepage feed, `/preveri`, member-sync preview), each replaceable with a server action + `useTransition`. This also removes `published-feed-query.ts` and `cache-invalidation-client.ts`.

## DROP (don't port)

- **All of `scripts/` except sweep-stale-content, backup, and the issuer backfill.** About 6.9k lines of code in 58 files; the 2008→2022 migration is finished and the current DB is the source of truth. This includes `scripts/retired`, `scripts/migrate/*`, `tools/perceptual-match`, `artifacts/`, `vendor/` and `zbsearch-bench.ts`.
- Script-support code in `lib/` (~380 lines, selected by file name; confirm nothing in `app` imports them): `stale-media-refs`, `legacy-media-source`, `legacy-media-bytes`, `resolve-static-pdf`, `dehotlink-static-refs`, `legacy-diff-waivers` and their tests.
- `app/api/internal/revalidate` (exists only so scripts can bust the cache with a shared secret), `REVALIDATE_SECRET`, `apply_route_invalidations`.
- `app/dev/cache` + `server/cache-invalidation-action.ts` (manual cache-purge admin page), unless the new cache story needs a purge button.
- Date picker files that look unused: `components/date-time-picker/index.tsx` and `form.tsx` (~165 lines). Only `new_date_picker.tsx` is imported, by `settings-form.tsx`.
- Dependencies that showed zero imports. My grep only matched `from "pkg"`, so check config-referenced ones (`@tailwindcss/postcss`, `babel-plugin-react-compiler`) before deleting:
  - oRPC: `@orpc/client`, `@orpc/tanstack-query`, and `@orpc/next`/`@orpc/server` once actions are plain.
  - Pagination: `drizzle-cursor`, `drizzle-pagination`, `drizzle-zod`.
  - Algolia: `@algolia/*`, `instantsearch.css`, `react-instantsearch*`, `algoliasearch`, `instantsearch.js`.
  - AWS: `@aws-sdk/lib-storage`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/client-s3`.
  - Markdown/HTML: `unified`, `remark-parse`, `unist-util-is`, `editorjs-html`, `fast-xml-parser`, `node-html-parser`.
  - File tooling: `glob`, `globby`, `node-dir`, `@types/node-dir`, `csv-parse`, `image-size`.
  - Misc: `immer`, `klona`, `superjson`, `use-dynamic-refs`, `react-date-picker`, `server-only`, `@react-email/render`, `@tanstack/react-query-devtools`, `@editorjs/link`, `@editorjs/raw`, `@vercel/speed-insights`, `b2-js`, `sharp`, `@t3-oss/env-nextjs` (→ `env-core`), `googleapis`, `google-auth-library`.

## Risks / things to verify first

1. **Vinext + Server Actions + cache invalidation.** The old design used Next's `updateTag` inside real Server Actions. Smoke-test one action, one invalidation, and the Hyperdrive Postgres connection before porting any UI. Old ADRs 0005 and 0006 (`.references/jknm/docs/adr/`) explain the caching constraints.
2. **Workers limits.** Bundle size (the `googleapis` removal helps) and CPU time for building the search index.
3. **Server Action error redaction** in Vinext production builds, which decides whether the `Result` wrapper is needed.
4. Old `docs/architecture.md` is stale (it still describes Vercel and better-auth 1.6.27); trust `package.json` and the code.
