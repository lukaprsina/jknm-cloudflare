# Spike: local (client-side) zbsearch for /arhiv and ctrl-K

Run 2026-10-31 on branch `spike/search-local`. zbsearch 4.0.1 (`@zbsearch/plugin-data-persistence` 4.0.1, `@zbsearch/stemmers` 4.0.1), headless Chromium 156 via `agent-browser`, workerd 1.20261019 locally, scratch Workers deployed and deleted. Corpus: 700 published articles (695 `article` + 5 `content`; #45 had 697) from read-only SELECTs, 2.24 MB plaintext. No secrets in this file.

**Account caveat that shapes item 5:** `cf accounts subscriptions get` shows the Cloudflare **Free** plan (plus R2 Paid), not Workers Paid. Free allows no `limits.cpuMs` (deploy rejected: error 100328) and a 10 ms CPU cap. Deployed CPU numbers below are therefore from successful invocations only, see item 5.

## Verdicts

| #   | Item                                                         | Verdict                              | Key number                                                                                                                                                                                               |
| --- | ------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Install without override; Slovenian stemming in library mode | **PASS**                             | `vp add` clean, no override. `components.tokenizer = { stemming: true, stemmer, language }` from `@zbsearch/stemmers/slovenian`. **Trap:** `restore()` drops it (see below).                             |
| 2   | Corpus + schema                                              | **PASS**                             | 700 rows; 9 without author; schema below                                                                                                                                                                 |
| 3   | Features in library mode                                     | **PASS** (one trap)                  | facets, 6 sorts + relevance, tolerance, filters, offset all work; "jama" = **667** hits stemmed (not 487)                                                                                                |
| 4   | Persist formats + browser                                    | **PASS for json; FAIL for seqproto** | json br11 1.54 MB, restore 56 ms Node / 61 ms Chromium / 183-187 ms at 4x CPU. seqproto loses sort + enum filters and cannot load in a browser bundle                                                    |
| 5   | Build inside a Worker                                        | **PARTIAL**                          | Works locally and deployed (1049 ms CPU one request, brotli q5, 1.76 MB). q10/q11 brotli does not fit; Free plan cannot confirm the default paid limit; memory has no gauge (2x corpus OK)               |
| 6   | Rebuild cost after one change                                | **PASS**                             | Full rebuild = same as item 5 (~0.4-0.7 s index + ~0.1-0.5 s serialise + brotli). DB read 1.7 s wall (I/O) from the dev machine. Incremental update saves little (Node 135 vs 317 ms before compression) |
| 7   | Report 01/02 errors                                          | **Found 8**                          | see last section                                                                                                                                                                                         |

## 1. Install and stemming

- `vp add zbsearch@4.0.1 @zbsearch/plugin-data-persistence@4.0.1 @zbsearch/stemmers@4.0.1`: no override; the plugin's dependency is now `"zbsearch": "4.0.1"`. 4.0.0 still fails under npm (`EUNSUPPORTEDPROTOCOL workspace:*`; worked in `/tmp` only with `overrides`).
- Config (docs `text-analysis/stemming.mdx`): `create({ schema, components: { tokenizer: { stemming: true, stemmer, language } } })`.
- **Trap:** `restore(format, data)` (`plugin-data-persistence/src/index.ts`) does `create({schema:{__placeholder:"string"}})` with the **default English, unstemmed tokenizer**, then `load`. Query terms are then not stemmed: `jame` finds 1 doc, `jama` 490. The #45 "487 accurate stemmed hits" was exactly this (unstemmed query against a stemmed index). Real stemmed numbers below. Use `makeDb()` (same `create` options) + `load(db, JSON.parse(text))` on the client.

## 2. Corpus and schema

Extraction as the old bench: EditorJS blocks `paragraph|list|quote`, `sanitize-html(allowedTags: [])` + `html-entities.decode` + trim. In-Worker replacement `html.replace(/<[^>]*>/g,"")` + `decode` gave **0 differences in 700 docs** (no `sanitize-html` needed in the Worker).

`lib/spike-search/schema.ts`:

| field           | type          | use                                                                      |
| --------------- | ------------- | ------------------------------------------------------------------------ |
| `title`         | `string`      | searchable, sort                                                         |
| `body`          | `string`      | searchable (not stored: custom `documentsStore.store` drops it)          |
| `author`        | `string`      | "Priimek, Ime" of first author: sort key (old `first_author_sort`)       |
| `author_ids`    | `string[]`    | author facet (multi-valued)                                              |
| `year`          | `string`      | year histogram (facet counts per value); `where: { year: "2019" }` works |
| `published_at`  | `number`      | sort + range filter                                                      |
| `article_kind`  | `enum`        | `where: { article_kind: { eq: "article" } }` (a bare string throws)      |
| `slug`, `thumb` | not in schema | display-only, stored in docs store                                       |

Dropping `body` from the docs store: json 8.70 -> 6.44 MB raw, brotli 1.539 -> 1.512 MB (small gain, ~2 MB less to parse).

## 3. Features (Node and Chromium, same results)

- "jama": 667 hits all props (665 on `properties: ["title","body"]`); `jame/jamo/jami/jamah` also 667 (inflections match); unstemmed index 596; `jamarji` 490 stemmed (`jamar` 490: a different stem). Search is prefix-based, so counts are far higher than whole-word counts.
- 4.0.0 vs 4.0.1 on this corpus: **identical** (667 / 490 restored / 596 unstemmed); a 4.0.0 json artifact loads in 4.0.1 with identical answers. No tokenization change visible; still rebuild on upgrade (docs say so).
- Facets `{author_ids:{limit:100}, year:{}}` respect the query (87 authors for "jama"). Sorts on `published_at`, `title`, `author` both orders OK (relevance = default). Docs without author sort first in ASC. `tolerance:1` "jamma": 589 (0 at tolerance 0). `where` kind: 660 article / 5 content. Offset pages 15/15, no overlap. Empty term returns all 700 (browse mode).
- ctrl-K needs the 5 `content` rows: one `where` per group (3 + 15 hits), both sub-ms.
- **Perf trap:** `term:""` **with** `properties:[...]` costs 18-23 ms (Node); without `properties` 0.0-0.1 ms. At 4x CPU it was 71-85 ms. Omit `properties` for browse mode.

## 4. Persist formats, then browser

Node (`scripts/spike-search-node.ts`, `spike-search-variants.ts`):

| format       | raw                | gzip    | br q11   | persist | restore | fidelity vs fresh db (7 probe queries, tokenizer patched)     |
| ------------ | ------------------ | ------- | -------- | ------- | ------- | ------------------------------------------------------------- |
| json         | 8.70 MB            | 2.88 MB | 1.539 MB | 72 ms   | 56 ms   | **identical**                                                 |
| seqproto     | 8.94 MB            | 2.33 MB | 1.557 MB | 81 ms   | 70 ms   | **`Sort is disabled`** on every sortBy; enum `where` = 0 hits |
| chunked json | 6.44 MB (stripped) |         | 1.512 MB |         |         | `loadAsync(parseChunked())` identical                         |

Cause (source `seqproto.ts:326-468`): serialises only Radix and Flat indexes and docs as strings; the sort index and enum/number structures are not written. Brotli size is no better than json. `qps` not used.

Browser (`app/spike-search/client/bench.tsx`, headless Chromium, 32-core desktop; deployed artifact, `Content-Encoding: br`):

| run                                      | fetch  | parse  | restore total | heap + | long tasks (>50 ms)                   |
| ---------------------------------------- | ------ | ------ | ------------- | ------ | ------------------------------------- |
| desktop, json                            | 478 ms | 39 ms  | **66 ms**     | 31 MB  | none                                  |
| desktop, chunked `loadAsync`             | n/a    | n/a    | 63 ms         | 29 MB  | none                                  |
| CPU 4x (CDP), 9 Mbit/s, 170 ms RTT, json | 1.9 s  | 134 ms | **187 ms**    | 35 MB  | 0-2 (90, 150 ms in an earlier 4x run) |
| CPU 6x, local                            | 417 ms | 203 ms | 284 ms        | 28 MB  | 146, 222 ms                           |

Queries after restore (median of 15): everything 0.2-0.8 ms desktop, 0.7-1.7 ms at 4x (first call up to 7.6 ms), combo (fuzzy + filter + facets + sort) 0.6 ms / 3.3 ms. The only slow one is the browse query (above). Client JS for zbsearch + Slovenian stemmer: 78 KB raw, 23 KB brotli.

**seqproto in the browser: does not work.** `import("@zbsearch/plugin-data-persistence")` (package root) throws `Class extends value undefined` at module evaluation in a Vite client bundle: the root pulls `dpack`, which extends Node's `stream.Transform` (Vite warns `Module "stream" has been externalized`). `deserializeZBSearchInstance` is not in the package `exports`. Core `load/loadAsync/parseChunked` from `zbsearch` need nothing from the plugin and work. Browser fallback numbers above are json.

## 5. Build inside a Worker

Code: `lib/spike-search/worker.ts`, routes `app/spike-search/{corpus,build,manifest}`, entry `lib/spike-search/worker-entry.ts`. Guard: `x-spike-token` secret. Corpus input from scratch R2 (`corpus.json`, 2.49 MB, `blocks` raw html).

**Local `vp dev` (workerd):** works. load 20 ms, +build 240 ms, +JSON persist 50 ms, brotli q11 **5.7 s** (dominant). `CompressionStream("brotli")` is not supported ("must be deflate, deflate-raw or gzip"); `node:zlib.brotliCompressSync` works under `nodejs_compat`.

**Deployed (CPU from Workers Logs `$workers.cpuTimeMs`, via `cf o11y telemetry query`, view `events`, filter `$metadata.service`; `/tmp/spike-search/cpu.sh` was the extractor):**

| step (cumulative phases are separate requests)    | CPU ms                                  |
| ------------------------------------------------- | --------------------------------------- |
| parse corpus (R2 get + JSON.parse 2.5 MB)         | 16-46                                   |
| + build (700 docs, stemming, strip body)          | 445-696                                 |
| + `JSON.stringify(save(db))` + encode (6.4 MB)    | 564-1232 (noisy)                        |
| brotli-only, 6.4 MB from R2: q4 / q5 / q7 / q9    | 268 / 200-306 / 651 / 521-686           |
| brotli q10 / q11 / `CompressionStream("gzip")`    | **exceeded** at 1290 / 2010 / 1078+ ms  |
| **all in one request, q5, incl. 2 R2 puts**       | **1049** (wall 1556), 1.76 MB           |
| scale x2 (1400 docs, vocabulary doubled), persist | 1663 ms, outcome ok (=> < 128 MB at 2x) |
| serve artifact via custom entry (R2 stream)       | 1-2 ms                                  |

- Artifact sizes: json raw 6.44 MB; br q4 1.84, q5 1.76, q9 1.66, q10 1.56, q11 1.51 MB; Cloudflare edge auto-compression of an uncompressed object served by the Worker: 2.04 MB (`content-encoding: br`, free).
- **Free-plan limiter behaviour (why numbers are sparse):** requests ran far above 10 ms for ~30-60 s after each deploy (hard stop ~1.3-2 s), then every request died at `cpu 10 ms, exceededCpu` (error 1102), with a budget of roughly 3 s CPU per window. At the real Free default the build **fails**. Paid default is 30 s, so q5 at ~1 s has ~30x margin (derived, not run). Option (b), chunking/Queue, was not needed or testable here.
- Memory: `process.memoryUsage()` returns 0 in workerd, no gauge. Evidence: x2 corpus persisted without `exceededMemory`. Node proxy (`scripts/spike-search-mem.ts`, JS heap cap): 1x passes at 56 MB cap (40 MB core-dumps), 2x needs 100-140 MB, 4x fails at 220 MB (pessimistic: tool heap included, vocabulary inflated). Reading: 1x is comfortable, 4x of this corpus would not fit; growth is superlinear.
- **Serving gotchas:** (1) dev bridge (`vp dev`) strips `Content-Encoding` from route handlers, so `?identity=1` decodes in the route for local tests. (2) A route handler returning pre-compressed bytes with `Content-Encoding: br` is **double-encoded** by workerd (default `encodeBody: "automatic"`; browser got brotli bytes, `decodedBodySize` = compressed size). Fix: `new Response(body, { headers, encodeBody: "manual" })` from a **custom Worker entry** (vinext's route layer does not preserve it). Verified: headers `content-encoding: br`, `content-type`, `cache-control: public, max-age=31536000, immutable`, encoded 1,762,327 / decoded 6,435,058 B in the browser. R2 custom domain (not tested, no DNS allowed) serves stored metadata as is.

## 6. Rebuild cost after one change

Trigger and cost equal item 5 (full rebuild: ~1 s CPU at q5). Extra: published-set fingerprint `max(updated_at),count` query 56 ms wall. Incremental (restore + `update` one doc + re-save, Node): 135 ms vs 317 ms full, before compression; not worth the complexity. DB read of 700 rows with `content_json` (4.2 MB): 1.7 s wall via the Supabase pooler from the dev machine (I/O, not CPU).

## Recommended design

- **Schema:** as item 2. `year` string facet, `author_ids` string[] facet, enum kind. Build with `stripBody`.
- **Library:** `create({schema, components:{tokenizer:{stemming:true,stemmer,language}}})` in one shared module used by builder and client. Never `restore()`; client does `JSON.parse` + `load` (or `parseChunked` + `loadAsync` if long tasks matter; at 700 docs they do not).
- **Format:** plain json, optionally chunked. No seqproto, no QPS, no plugin in the client.
- **Build trigger:** Queue consumer (01 6.3) on publish/unpublish/author events, 30 s delay to collapse bursts, fingerprint compare with `search/manifest.json`, skip if equal. Daily cron as safety net. Needs **Workers Paid** (set `limits.cpuMs`).
- **Compression:** `node:zlib` brotli **q5** in the builder (1.76 MB, ~0.25 s CPU); q9 (1.66 MB, ~0.6 s) is the ceiling. Avoid q10/q11 in the Worker. If 1.5 MB matters, build with q11 in CI/Node (5.7 s) instead.
- **Artifact:** key `search/zb4.0.1-<sha16 of raw>`, `Content-Encoding: br`, `Content-Type: application/json`, `Cache-Control: public, max-age=31536000, immutable`; manifest `{key,count,bytes,builtAt}` with `max-age=60`. Version prefix guards lib skew.
- **Serving:** R2 custom domain (preferred), or a dedicated entry using `encodeBody: "manual"`; never an ordinary vinext route handler. 1-2 ms CPU per hit through a Worker.
- **Client:** lazy `import()` of zbsearch + stemmer (23 KB br) and fetch on first ctrl-K / `/arhiv` mount; cache the db in a module singleton; omit `properties` on empty-term browse queries; map the old 6 replicas to `sortBy`.

## Open risks

- **Not measured on Workers Paid.** CPU/memory at the real default limit and under a Queue consumer are extrapolated. Human step: subscribe Workers Paid, deploy with `SPIKE_SEARCH=1 SPIKE_CPU_MS=60000`, repeat the item 5 requests (script list: `lib/spike-search/worker.ts` query params `phase`, `q`, `scale`, `format`).
- Memory headroom is about 2x this corpus; 4x is unlikely to fit. Escape hatch: Node/CI builder uploading to R2.
- zbsearch maintenance risk (5-week-old fork) and `restore()` default-tokenizer trap: a wrongly configured client silently returns 1-2 hits for inflected queries.
- R2 custom domain headers/CORS and edge-cache behaviour untested.
- Long tasks at 4x: 90-150 ms reported once; chunked `loadAsync` is the lever if it grows.
- Author sort: authorless docs sort first ascending; decide a sentinel.

## Report 01/02 corrections

1. 01 6.2 / handoff: `workspace:*` dependency is fixed in 4.0.1; the pnpm override is not needed.
2. 02 1.4 / #45: "487 stemmed hits" is an artifact of `restore()` using the default tokenizer; stemmed query on the stemmed index gives 667 (596 unstemmed). 4.0.0 and 4.0.1 behave identically.
3. 02 5.1: "seqproto only, never json" is backwards. seqproto drops the sort index and enum filters and cannot be imported in a browser bundle; json round-trips exactly and was fine in the Worker (6.4 MB). #45's +183 MB was `binary`.
4. 01 6.2/6.4: pre-compressed `Content-Encoding: br` via a vinext route is double-encoded by workerd; needs `encodeBody:"manual"` from a custom entry, or R2 custom domain. Dev server drops the header.
5. 01 6.2: brotli q11 "probably seconds" - measured 5.7 s locally and > 2 s on deployed CPU (aborted); `CompressionStream("brotli")` is unsupported and `"gzip"` was slow (> 1 s CPU for 6.4 MB). Use zlib q5-q9.
6. 02 2.4: restore estimate 0.7-1.5 s on phones was pessimistic: 187 ms at 4x CPU. Per-query 3.8-7.4 ms is now 0.5 ms (desktop) / ~1.5 ms (4x).
7. 02 7.1 threshold "median <= 25 ms incl. facets+sort+fuzzy": met everywhere except empty-term-with-`properties` (18-23 ms, 71-85 ms at 4x), which is avoidable.
8. 01/02 assume Workers Paid; this account is on Free (no `limits`, 10 ms CPU cap). Also: `process.memoryUsage()` returns 0 in workerd, and Free-plan measurements are only possible in a short window after each deploy.

## Files

Spike code (all deletable): `app/spike-search/**`, `lib/spike-search/**`, `scripts/spike-search-*`, `scripts/spike-env.sh`. Non-spike edits: `cloudflare.config.ts` (scratch names under `SPIKE_SEARCH=1`, R2 + secret bindings, observability, optional `SPIKE_CPU_MS`; unchanged behaviour without the env var) and `package.json` deps.
