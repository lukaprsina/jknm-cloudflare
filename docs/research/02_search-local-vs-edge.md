# Search for /arhiv and ctrl-K: local (client-side) zbsearch vs ZBSearch Edge

Researched 2026-10-30. Read-only pass over primary sources. Nothing was deployed or run; every number is either **docs-measured** (taken from the zbsearch docs or issue #45), **derived** (arithmetic on those numbers, labelled), or **UNVERIFIED**. Companion to `01_workers-port-unknowns.md` section 6, which this refines: section 6.1 said "ignore Edge"; this file gives the evidence for and against, and corrects two points in it (see 1.5).

Options, as the user framed them:

- **A, local**: `zbsearch` library, index built in a Worker (Queue consumer + Cron) from Postgres, `persist(db, "seqproto")` + brotli, stored in R2, restored in the browser.
- **B, Edge**: ZBSearch Edge (beta): one Worker + R2 + `IndexCoordinator` Durable Object, `/v1/indexes/:id/search` called server-side.

## Summary of verdicts

| #   | Question            | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Feature parity      | **Edge as published (4.0.1) does not meet #44.** Its search handler forwards only `term, mode, where, limit, offset, properties, boost, similarity, vector, hybridWeights`. `facets`, `sortBy`, `tolerance` (fuzzy), `threshold`, `groupBy` are dropped, so no facet counts, no sort, no fuzzy. Slovenian stemming is impossible: Edge only passes a `language` string, never a stemmer function. Filters, limit/offset pagination: yes. Highlighting: not used by the old UI. Parity needs a fork of `edge-core` (about 4 `create()` sites + 1 `search()` call). Library mode supports everything.                                                              |
| 2   | Cold-start argument | **Still holds on Workers.** An Edge isolate must `decode(msgpack)` + `load()` the whole snapshot before its first search (derived: roughly 0.3-0.6 s CPU for our corpus unstemmed, vs the docs' calculator assuming ~4 ms). Isolates are "not necessarily long-lived" (cloudflare-docs `how-workers-works.mdx:33`), and the docs' cold share (2%) is an assumption, not a measurement. Every search also does a `meta.json` R2 GET. Docs-measured warm e2e latency is 180-450 ms (p50 about 170 ms, p95 about 270 ms at 10k docs). Local: 1.4 MB once per session + restore, then <10 ms per query with zero round trips.                                        |
| 3   | Operations          | Edge = 1 Worker + 1 DO class that matters (+1 unused declared) + 1 R2 bucket + 2 secrets + cron + `cpu_ms=300000`, own `wrangler.toml` lineage, beta, hard-coded `/v1/info` version `0.1.0`, no documented breaking-change policy, snapshots never garbage-collected (UNVERIFIED but no delete in `runRebuild`). Local = 1 Queue + 1 cron + 1 R2 prefix in infrastructure we already own, testable in Node/vitest. Publish visibility: Edge WAL overlay = immediately, but while any op is pending **every search rebuilds the whole index in memory**, and with default threshold 500 a low-write site is permanently "dirty" unless `REBUILD_THRESHOLD_OPS=1`. |
| 4   | Cost                | Both are **about $0 marginal** on the Workers Paid plan we already need ($5 base). Edge worst case about $0.50/month at 50k searches if every search is cold; local under $0.05. Cost is not a decider.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | Memory/CPU          | Both build inside a 128 MB Worker. A: new DB + export + seqproto + brotli (stemmed, heap "noise" for seqproto per #45). B (Edge): in-Worker (not in a DO) rebuild = decode old snapshot into a DB, copy docs, build new DB, save, msgpack encode, unstemmed so about 2x bigger. Edge's own docs give an OOM point (8 x 16.5 MB = 132 MB). Both unmeasured for our corpus.                                                                                                                                                                                                                                                                                        |
| 6   | UX/SEO              | Today's /arhiv is `force-dynamic` and fully client-rendered (`ssr:false` on every widget), so SSR/SEO would be a **new** feature, not parity. B can server-render (RSC calls Edge over a service binding) but facet/sort clicks become server round trips; A is instant. A hybrid is **not** sensible: two pipelines, two index states, and Edge cannot stem Slovenian.                                                                                                                                                                                                                                                                                          |
| 7   | Spike               | Section 7. B has a 30-minute kill-test that should run first (probe whether facets/sortBy/tolerance are honoured). A's spike is 01 section 6.6 plus the features #45 never benchmarked (it only ran `term: "jama"`).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 8   | Recommendation      | **Pick A (local).** Edge fails four hard requirements as shipped, so B really means "maintain a fork of a beta package". Flip conditions in section 8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## 1. Feature parity

### 1.1 What #44 and the old UI actually require

From `gh issue view 44` (destination line) and `.references/jknm/src/app/arhiv/*`, `components/shell/searchbar.tsx`:

| Need               | Where it is used                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author facet       | `AuthorRefinement`: facet on `author_ids` (multi-valued), `limit: 100`, counts shown (`components.tsx:259-295`). Requires facet counts that respect the current query. |
| Year histogram     | `YearHistogram`: facet on `year`, sorted by name, counts drive bar heights (`components.tsx:372-417`).                                                                 |
| 4-field sort       | `SORT_BY_ITEMS`: relevance, published_at asc/desc, title asc/desc, author asc/desc (`components.tsx:65-73`). Six Algolia replicas become `sortBy`.                     |
| Fuzzy              | #44 "Not yet specified": tolerance 0-1 typo.                                                                                                                           |
| Slovenian stemming | The reason zbsearch was picked (#44, #45: 487 stemmed hits, index halved).                                                                                             |
| ctrl-K             | Two queries per keystroke burst (3 "content" hits + 15 "article" hits), debounce 100 ms, maxWait 1500 ms, filter by `article_kind` (`searchbar.tsx:35-81`).            |
| Highlighting       | **Not used.** No `Highlight`/`Snippet` in `src/app/arhiv/*` or the card component (grep). Ignore it.                                                                   |

### 1.2 Library mode (option A): everything is documented

`facets` (string, number ranges, boolean, enum, and `string[]` array fields: one count per element, `zbsearch/search/facets.mdx:1-205`), `sortBy` on string/number/boolean with `order` (`search/sorting.mdx`), `tolerance` (`search/index.mdx:168-190`), filters (`search/filters.mdx`), `limit/offset`. These compose in one `search()` call.

### 1.3 Edge mode (option B): documented API vs source

Docs, `cloudflare/api-reference.mdx:298-311`: the search body lists `term, mode, where, limit, offset, properties, boost, similarity, vector, hybridWeights`. No `facets`, `sortBy`, `tolerance`.

Source, `packages/edge-core/src/service.ts:677-688`: the `search(loaded.db, {...})` call builds its options from exactly those ten fields and nothing else. `SearchInput` (`:116-133`) has no other fields. I also unpacked the published tarball `@zbsearch/edge-core@4.0.1` from npm: `dist/service.js` contains 0 occurrences of `facets`, `sortBy`, `tolerance`; only `dist/shard-group.js` mentions `facets` (a merge helper). No test passes `facets`/`sortBy`/`tolerance` through the HTTP layer (`grep` over `edge-core/tests`, `runtime-cloudflare/tests`; the only `facets` hit is a unit test of the merge helper, `sharding.test.ts:329-354`).

Doc/source inconsistency to be aware of: `api-reference.mdx:357` says "Facets _are_ merged" on sharded indexes. The merge code exists (`shard-group.ts:140-157`), but a client cannot request facets, so it never triggers. Treat that sentence as aspirational.

Verdicts for Edge as published:

| Feature                                                      | Edge 4.0.1                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Author facet, year histogram (facet counts)                  | **No** (not forwarded; no `facets` in response)                 |
| Sort by 4 fields                                             | **No** (`sortBy` not forwarded)                                 |
| Fuzzy / typo tolerance                                       | **No** (`tolerance` not forwarded)                              |
| Slovenian stemming                                           | **No** (see 1.4)                                                |
| Filters (`where`, e.g. `article_kind`, `year`, `author_ids`) | Yes                                                             |
| Pagination                                                   | Yes (`limit`/`offset`; sharded merges `offset+limit` per shard) |
| Highlighting                                                 | n/a (unused by the old UI)                                      |

Workaround without a fork: ask for `limit` = all 697 hits and sort/facet/paginate in the Vinext Worker. That moves the whole feature into our code and ships every stored document (including the plaintext `body`, about 3 KB each, 2.14 MB total per #45) on each call, because the API has no field projection. Not recommended; it defeats the point of Edge.

### 1.4 Slovenian stemming: library vs Edge configuration

- Library (and the old bench script): `create({ schema, components: { tokenizer: { stemming: true, stemmer, language } } })` with `{ stemmer, language } from "@zbsearch/stemmers/slovenian"` (`scripts/zbsearch-bench.ts:1-6, 124-129`; docs `text-analysis/stemming.mdx:22-44`).
- The tokenizer only stems when `config.stemming` is set or a `stemmer` function is passed; for any non-English language without a function it throws `MISSING_STEMMER` (`packages/zbsearch/src/components/tokenizer/index.ts:195-210`).
- Edge: every `create()` call is `create({ schema, language: meta.settings.language, inferSchema })` (`service.ts:287-291, 401-405, 469-473, 600-604`). `language` is a JSON string stored in index settings (`api-reference.mdx:445-452`); a stemmer is a function and cannot be stored there. `grep -i "stemm|tokenizer|components"` over `edge-core/src`, `runtime-cloudflare/src`, `edge-index-builder/src`, `storage-s3/src` returns nothing. So `language: "slovenian"` gives the Slovenian tokenizer and stop-words, **but stemming is off**.
- Consequences (derived from #45): unstemmed index about 15 MB JSON-equivalent vs 8.2 MB stemmed (numbers from the Orama run; zbsearch run says stemming halved the index); and inflected Slovenian queries match less (zbsearch's own multilingual benchmark shows 0.70 vs 0.98 recall@10 with/without per-language stemming, `supported-languages/index.mdx:41`).
- Tokens are baked into the snapshot at build time ("an index carries the tokens of the version that built it", `usage/serialization.mdx` Compatibility). Fixing this means patching all four `create()` sites + the builder CLI's `import`, bundling `@zbsearch/stemmers/slovenian` into the Edge Worker (startup < 1 s limit, 01 section 6.2), and keeping the fork current.

### 1.5 Corrections to 01

- 01 section 6.2 says the `workspace:*` publish bug is UNVERIFIED as fixed. **Verified fixed in 4.0.1**: `npm view @zbsearch/plugin-data-persistence@4.0.1 dependencies` lists `zbsearch: '4.0.1'`; release notes v4.0.1 include "Guard against publishing unresolved workspace: ranges" (#68). The handoff's `zbsearch: 4.0.0` pnpm override is no longer needed and pins an older engine.
- 4.0.1 also changed tokenization ("Keep repeated tokens by default so BM25 sees term frequencies" #70; "keep letters from other scripts and trim edge punctuation" #73). The #45 sizes/hits (1.43 MB, 487 hits) were measured on 4.0.0 and must be re-measured on the version we ship.
- The "~240 ms restore" in the handoff is a **Node** measurement (`scripts/zbsearch-bench.ts` timing `restore()`), not a browser one. Docs also label `seqproto` "Compact binary, Node-oriented" (`plugins/plugin-data-persistence/storage-adapters.mdx:95`). Browser restore of seqproto is **UNVERIFIED**; `json` (1.41 MB brotli, 204 ms in #45) has an async chunked restore (`save(db,{format:"chunked"})` + `loadAsync`, `usage/serialization.mdx`) that avoids freezing the main thread.

---

## 2. Does the #44 cold-start argument hold on Workers?

#44's logic: low traffic means most requests land on a cold instance, so a server-side warm singleton never amortises `restore()`.

### 2.1 Edge cold path (what a search pays)

Layers, fastest first (`indexing-and-rebuilds.mdx:58-62`; code `service.ts:376-409`):

1. Per-isolate LRU of deserialized DBs (default 4 entries / 64 MB; key = versioned snapshot key).
2. Workers Cache API (`caches.default`), raw snapshot bytes, TTL 3600 s (`service.ts:397`), **per data center only** (cloudflare-docs `workers/runtime-apis/cache.mdx:19`) and "functional" only on Workers deployed to **custom domains** (`:27`). The Edge Worker on its default `*.workers.dev` hostname therefore likely gets no Cache API layer (UNVERIFIED for a Worker reached by service binding). Put the Edge Worker on a custom route.
3. R2 `GET indexes/{id}/{version}/snapshot.msgpack`.

On a cold isolate, even with the bytes cached: `decode(bytes)` then `create()` + `load()` (`service.ts:400-407`). No numbers exist for a ~700-doc index. Derivation:

- #45 (Node, Orama, unstemmed, BM25): restore 278 ms (json 14.96 MB), 603 ms (binary/msgpack path) for 697 docs.
- Edge docs cold: "cold ~2.7 s = one-time load of 4 shard snapshots" for 96k docs / 124 MB (`benchmarks.mdx` line 123 of the file), about 22 ms/MB; and "3.3 s cold -> ~330-450 ms warm" for 8 shards (line 124).
- For a ~10-15 MB snapshot both give **about 0.25-0.6 s CPU on a cold isolate** (derived). The cost calculator assumes "+~5 us/doc, ~0.5 s at 100k docs, 2% of searches" (`cost-calculator.mdx:18`), i.e. about 3.5 ms for 697 docs: 50-100x lower than the measurements above for a corpus with 2-3x longer documents. Do not use the calculator's cold figure for our bill or latency.
- Docs-measured max latency on cold isolates: 16 s (10k docs, 4 shards, `benchmarks.mdx` line 120) and 60 s (DOs cold, 100k docs, line 121). Not representative of 697 docs, but shows cold handling has no mitigation beyond "keep it warm".

How often is a search cold? Cloudflare does not document an isolate idle TTL; only "not necessarily long-lived" (`how-workers-works.mdx:33`). At 10k-50k searches/month (about 14-70 per hour averaged, bursty) from mostly Slovenian traffic (few colos), a meaningful share of sessions will start cold: **UNVERIFIED, the spike must measure it** (7.2, probe 3). Also every rebuild changes the version key, so every isolate and colo re-warms once after each publish (`production.mdx:169`).

### 2.2 Per-search work on a warm Edge path

- DO involvement: **none for our index**. Reads use `IndexCoordinator` never; `ShardSearch` DO is used only when `env.SEARCH_SHARD` is bound **and** the index is a shard group (>= 2 shards, `api-reference.mdx:119`; `worker.ts` `shardSearchExecutor`; `runSearch` branches on `isShardGroupMeta`, `service.ts:667-669`). 697 docs need no sharding. Writes use the coordinator (WAL append, rebuild lock, `coordinator.ts:88-206`).
- R2: every search calls `getIndexMeta` = one R2 GET of `indexes/{id}/meta.json`, uncached (`service.ts:665`, `registry.ts:30-36`; confirmed by `cost-calculator.mdx:21`). Docs' own explanation for 180-450 ms warm e2e: "engine time is tens of ms - the rest is network RTT and per-shard `meta.json` reads from R2" (`benchmarks.mdx` line 128).
- If `meta.pendingOps > 0`: R2 reads of the WAL (10-way parallel) + `loadDocumentsFromSnapshot` + a fresh `create()` + `insertMultiple` of all documents **per search** (`service.ts:431-478`). Docs: "Dirty searches re-index the whole index per request" (`benchmarks.mdx` line 111; collapse to 8.5 s/search at 89k docs). Derived for 697 docs: about 0.05-0.2 s CPU per search (unstemmed insert, ~62-95 us/doc at 1.3 KB docs, more for 3 KB docs). Survivable at our size, but it is the default state of a low-write site (see 3.4).

### 2.3 Latency for search-as-you-type

Docs-measured (deployed, Workers Paid, k6 from a residential line, so includes internet RTT): median 168 ms, p90 233, p95 273 at 10k docs / 4 shards in-process (`benchmarks.mdx` line 120); warm single request 180-450 ms (line 128). Our single unsharded index does fewer meta reads (1 vs 5), so expect the low end. With the old debounce (100 ms, `searchbar.tsx:44`) the user sees results about 100 + 170-300 ms after the last keystroke, plus out-of-order response handling in the UI (cancel stale requests). Acceptable for ctrl-K, noticeably slower than local for /arhiv facet toggles (2.5, 6.2). First keystroke of a session may hit a cold isolate (2.1).

### 2.4 Local cold path

- Bytes: ~1.4 MB brotli (#45, zbsearch 4.0.0 seqproto 1.43 MB, json 1.41 MB). At 10/20/50 Mbit/s that is about 1.1/0.6/0.25 s of transfer (derived). Content-hashed immutable URL (`Cache-Control: immutable`) => later visits and other tabs hit the browser HTTP cache; R2 custom domain fronted by Cloudflare's cache means R2 is touched rarely (01 section 6.4).
- Restore: 204-243 ms in Node on a developer machine (#45). Phone CPUs are typically several times slower (derived guess, UNVERIFIED): 0.7-1.5 s. Must not freeze the page: lazy-load on first ctrl-K / on /arhiv mount (prefetch on hover/focus), use the chunked `loadAsync` path or a Web Worker (explicitly out of scope in #44 "evaluated and dropped", revisit only if the spike shows long tasks).
- Per query: 3.8-7.4 ms (#45, `term:"jama"`, no facets/sort/tolerance; **those were never benchmarked**).
- Compare: Edge pays decode **per cold isolate** (many per month, same cost but on our CPU bill and user-visible as a slow first keystroke), local pays it **per page load that opens search**, on the visitor's device, with zero network per interaction.

### 2.5 Verdict

The argument transfers. Low traffic => cold isolates on Workers just as on Vercel; Cloudflare's per-colo Cache API only removes the R2 read, not the decode. What changes vs Vercel: Workers cold starts for the _runtime_ are cheap, but the _data_ load (the cost #44 cared about) is the same. The client-side facet/sort/histogram interaction argument is independent of platform and still holds.

---

## 3. Operations and failure modes

### 3.1 What you deploy and maintain

|                 | A: local                                                                                                                    | B: Edge                                                                                                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workers         | Queue consumer + `scheduled` handler (in the Vinext Worker via custom entry, or an auxiliary Worker; 01 section 6.2/risk 6) | `zbsearch-edge` Worker (npm `@zbsearch/runtime-cloudflare`, entry `src/worker.ts` bundled from `node_modules`, `setup.mdx:197`)                                                                                                                                                       |
| Durable Objects | none                                                                                                                        | `IndexCoordinator` (SQLite class, writes + rebuild lock) and `ShardSearch` (declared by template, unused unless sharded): two `[[migrations]]` tags (`setup.mdx:137-158`)                                                                                                             |
| R2              | 1 bucket/prefix, public custom domain                                                                                       | 1 bucket (+ preview bucket); the Worker binds it natively                                                                                                                                                                                                                             |
| Secrets         | none new (Hyperdrive etc. already planned)                                                                                  | `WRITE_API_KEY`, `READ_API_KEY`; optional `BUILDER_WEBHOOK_URL` (`setup.mdx:197-214`); S3 token for the builder CLI/CI                                                                                                                                                                |
| Triggers        | Queue + Cron                                                                                                                | Cron `*/5` in its own `wrangler.toml`; `[limits] cpu_ms = 300000`                                                                                                                                                                                                                     |
| Config lineage  | `cloudflare.config.ts`                                                                                                      | `wrangler.toml` generated by `zbsearch-edge-setup` (wizard writes `zbsearch.edge.config.json`, `.env`, deploys). Translating to `@cloudflare/config` incl. DO SQLite migrations: UNVERIFIED. Precedent for a second auxiliary Worker exists (response store, `cloudflare.config.ts`). |
| Extra CI        | none                                                                                                                        | optional GitHub Action + relay Worker for `repository_dispatch` if the external builder is used (`production.mdx:81-120`)                                                                                                                                                             |

### 3.2 How the Vinext Worker would call Edge

- Preferred: **service binding** (`env.SEARCH.fetch(new Request("https://search/v1/indexes/articles/search", {method:"POST", headers:{authorization:"Bearer <READ_API_KEY>"}, body}))`). Edge only exposes `fetch` (no RPC methods, `worker.ts`), so it is HTTP-shaped over the binding. Service-binding calls add no request fee and are billed as one request plus CPU of both Workers (cloudflare-docs `workers/platform/pricing.mdx:304-312`); both run on the same thread/server by default (`service-bindings/index.mdx:22`). Keep the Edge Worker private: set `workers_dev = false` and no routes (the service-bindings doc: "Isolate services from the public Internet", `:31`). Auth keys are still needed unless the Worker is unreachable (`router.ts` `ensureReadAuth`; with no keys the API is open).
- Browser-direct: `Access-Control-Allow-Origin: *` is hard-coded (`api-reference.mdx:456-458`; `worker.ts`), so CORS works but cannot be tightened without a fork, and the READ key becomes public (docs call that "safe to embed", `setup.mdx:197`). The route needs a custom domain (also gives a functional Cache API, 2.1). No rate limiting beyond "Cloudflare Access or WAF" suggestions (`production.mdx:218`).
- Key rotation: single key per role, no multi-key (`production.mdx:43-45`).

### 3.3 Local dev and testing

- A: pure functions over rows (build) and a deterministic artifact: vitest/pglite in Node, golden-query tests (fixed 20 queries, hit counts must match, like the 487 for "jama"). Browser side tested in jsdom or Playwright. No workerd needed for the core.
- B: the Edge packages' own tests are Node with mocked R2 and `caches.default` (`local-development.mdx:113`); no workerd/miniflare tests exist (no `pool-workers`/`miniflare` in package.json). Count of `it()` cases: edge-core 151, runtime-cloudflare 34, storage-s3 12, edge-index-builder 11 (grep). Coverage for the paths we need (facets, sort, fuzzy, stemming) is zero because those paths do not exist. For our app, `vp dev` must run the Edge Worker as an auxiliary worker with R2 and a SQLite DO locally: plausible (docs: `wrangler dev` "simulates R2 locally", `local-development.mdx:16-27`) but UNVERIFIED under `@cloudflare/vite-plugin` 2.0 beta + `@cloudflare/config`. App tests would stub the service binding.

### 3.4 Publish / unpublish / delete mapping

| App event                                               | A: local                                                                                                                                                                                                                                         | B: Edge                                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| publish / update of a published article / author rename | send `SEARCH_REBUILD` message (delay 30 s) after commit; consumer rebuilds whole index (idempotent, hash skip). Searchable when the new `current.json`/hash is fetched by the client: up to the delay + build time, then next page load or poll. | `PUT /documents/:id` or `POST /documents/batch` (id = article id; fields: title, plaintext body, author_ids, year, published_at, article_kind, slug). Returns 202 after WAL append (coordinator DO + R2 PUTs). |
| unpublish / archive / delete                            | same (the rebuild reads only `published`)                                                                                                                                                                                                        | `DELETE /documents/:id` (WAL delete op)                                                                                                                                                                        |
| Searchable when                                         | after rebuild + artifact swap                                                                                                                                                                                                                    | **immediately via WAL overlay** (`includesBuffer: true`, `service.ts:444-478`, test `search.test.ts:16`); durable after rebuild                                                                                |

Edge caveats (all from source/docs):

1. Docs contradict themselves: `indexing-and-rebuilds.mdx:40,101` say writes are "not searchable until rebuild"; `api-reference.mdx:196,351` and the code say overlay. Source wins.
2. **Overlay is expensive**: each search while `pendingOps > 0` re-creates the entire DB (2.2). It ends only when a rebuild runs.
3. **Rebuild trigger**: `maybeScheduleRebuild` returns unless `pendingOps >= threshold` (default 500, `service.ts:512-515`; `setup.mdx:299-305`). The cron only rebuilds when the threshold is met (`indexing-and-rebuilds.mdx:130`). At 1-5 publishes per day the default means **never rebuilds**, i.e. permanently dirty and the index grows an unbounded WAL. Mitigation: set `REBUILD_THRESHOLD_OPS=1` (rebuild per write, in `waitUntil`) or have the app call `POST /rebuild` after each write batch.
4. Every rebuild writes a new immutable snapshot and `runRebuild` never deletes the previous one (`service.ts:569-647`; only WAL segments are deleted at finalize, `coordinator.ts` `finalizeAfterRebuild`). UNVERIFIED by a deployed run. About 10-15 MB x rebuilds/month accumulates; add an R2 lifecycle rule.
5. `DELETE /v1/indexes/:id` does not purge R2 objects (`api-reference.mdx:188`).

### 3.5 Rebuild cost for 697 docs

- A: spike-measured (01 6.6): decode none (always from Postgres), `create+insert` 697 stemmed docs, `persist`, brotli. Estimated seconds of CPU, UNVERIFIED.
- B: load old snapshot into a DB (decode + load, 2.1) + copy docs to a Map + `create()` + `insertMultiple` + `save` + msgpack encode + R2 PUT. Docs-measured 62 us/doc for 1.3 KB English docs, "96k docs in about 6 s CPU" (`cost-calculator.mdx:20`). For 697 docs derived: decode 0.3-0.6 s + insert 0.05-0.2 s => **about 0.5-1 s CPU**. Far under the 30 s default and 5 min cap.

### 3.6 When a rebuild fails

- B: `runRebuild` catch resets `status` to ready/empty and rethrows (`service.ts:640-646`); the `finally` releases the DO lock (`:559-563`). WAL segments are only deleted at finalize, so no data loss. If the isolate dies (OOM, error 1102) the `finally` never runs; the lock becomes stealable after 15 minutes (`production.mdx:198`, `coordinator.ts:32`). While stuck, the index stays dirty: every search re-indexes everything (2.2). If that dirty path itself exceeds 128 MB, **searches fail**, not just publishing. Observability: poll `/status` for `pendingOps` and `lastRebuildAt` (`production.mdx:193-199`); nothing alerts for you.
- A: the old artifact stays live (content-hashed object + pointer is only rewritten after a successful upload). Failure = stale search, never an outage. Queue retries + DLQ (01 section 6.3). The Cron safety net catches missed messages.

### 3.7 Repopulating from Postgres

- A: the rebuild already _is_ the repopulate; nothing else to restore. Postgres is the only source of truth.
- B: R2 is "the source of truth" (`production.mdx:245-254`), so Postgres and Edge are two mutable copies again (the exact problem #44 removed from Algolia). To resync you need an extra job: either `zbsearch-edge-builder import <index> file.json --create` (needs the S3 token + a Node runner, `setup.mdx:271-280`; replaces the snapshot and clears the WAL, `indexing-and-rebuilds.mdx:225-230`), or a batch-upsert loop (100 per request) plus deletes for rows that no longer exist (no diff API). Plan a nightly reconciliation.

### 3.8 Beta status, stability, cadence

- Edge is explicitly beta on every page; "APIs, defaults, and CLI behavior may change. Pin package versions" (`setup.mdx:92`); "Treat production rollouts as early adopters ... keep a rollback path" (`production.mdx:7`). No documented deprecation or breaking-change policy; snapshot-format changes: "check release notes. No automatic migration runs in v1" (`production.mdx:267`).
- Hard-coded `GET /v1/info` returns `version: "0.1.0"` (`router.ts:152`; docs `api-reference.mdx:72-74`) although packages are 4.0.1, so the endpoint is not usable to detect versions.
- Release cadence (gh): v3.2.1 2026-07-09, v3.3.0 07-10, v3.3.1 07-14, 3.3.2 07-21, 3.3.3 07-22, 3.3.4 07-27, **v4.0.0 2026-08-11** (major), **v4.0.1 2026-09-29**; HEAD of main 2026-10-08. Repo created 2026-07-08 per `gh api`, 306 stars, 7 open issues. The local clone is a single-commit shallow clone, so per-package history is not available; the v4.0.0/v4.0.1 release notes do not mention Edge at all (UNVERIFIED how Edge breaking changes would be announced). Edge deploy docs describe the "monorepo" mostly; `edge-core`/`runtime-cloudflare` are 4.0.1 on npm.
- The library (`zbsearch`) shares the same maintainer and the same churn risk, but A depends only on the stable surface (`create/insert/search/persist/restore`), which #44 already accepted and mitigated by pinning.

---

## 4. Cost

Assumptions: 697 docs, 10k and 50k searches per month, about 30 publishes per month (one rebuild each), existing Workers Paid plan ($5, 10M requests and 30M CPU-ms included, then $0.30/M and $0.02/M CPU-ms: `cost-calculator.mdx:24`; `workers/platform/pricing.mdx:33`). R2: $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, egress free, free 10 GB / 1M A / 10M B (`r2/pricing.mdx:30-34, 55-58`). DO: $0.15/M requests, 1M included.

### 4.1 Edge (calculator inputs applied; cold share made explicit)

| Line                                                                                      | 10k searches                                                              | 50k searches                                                                                                                           | Basis                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Worker requests                                                                           | 10k                                                                       | 50k                                                                                                                                    | 0.1%-0.5% of 10M included. Via service binding from the Vinext Worker: no extra request fee (`pricing.mdx:304-312`). |
| Worker CPU, warm                                                                          | about 3 ms x searches = 30k-150k ms                                       |                                                                                                                                        | calculator 0.4 ms/1k docs = 0.3 ms; use 3 ms to cover JSON + msgpack handling                                        |
| Worker CPU, cold                                                                          | 2% cold (docs' assumption) x 0.4 s = 80k ms; **100% cold** = 4M ms        | 400k ms; **100% cold** = 20M ms                                                                                                        | 0.4 s per cold isolate is derived (2.1)                                                                              |
| R2 Class B (meta.json, plus calculator's shards+1 = 2)                                    | 20k                                                                       | 100k                                                                                                                                   | 0.2%-1% of the 10M free                                                                                              |
| R2 Class A (writes: WAL segment, open mirror, head, meta, snapshot per write; about 8-10) | about 300                                                                 | about 300                                                                                                                              | of 1M free                                                                                                           |
| R2 storage                                                                                | 15 MB x ~30 snapshots/month, never GC'd => about 0.45 GB/month cumulative |                                                                                                                                        | free 10 GB lasts about 2 years; then $0.015/GB                                                                       |
| DO requests                                                                               | writes only (about 100)                                                   | about 100                                                                                                                              | of 1M free; no ShardSearch for an unsharded index                                                                    |
| **Total, Edge**                                                                           | **$0 marginal** (or $5 if this were the only Worker)                      | **$0 marginal**; worst case (100% cold) 20M CPU-ms is within the 30M included, shared with SSR; overage would cost at most about $0.40 |                                                                                                                      |

### 4.2 Local

| Line              | Cost                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Artifact delivery | R2 public custom domain: no Worker invoked; at most 1 R2 GET per cache miss (<20k Class B/month of 10M free). Egress free. If served through a Worker route instead: +1 request and about 1 ms CPU per session, still inside the free allowance. |
| Builds            | about 30 publishes + 30 cron runs = 60 invocations x 2-10 s CPU (UNVERIFIED, spike) = 120k-600k CPU-ms, i.e. 0.4%-2% of the 30M included                                                                                                         |
| Queue             | about 100 messages/month; included operations (exact queue pricing partial not read: UNVERIFIED but orders of magnitude below any charge)                                                                                                        |
| R2                | storage 1.4 MB x versions (or overwrite the pointer, GC old hashes), writes about 120 Class A/month                                                                                                                                              |
| **Total, local**  | **$0 marginal**; visitor-side data is 1.4 MB per uncached session (not our bill)                                                                                                                                                                 |

Conclusion: cost is not a decider. The only cost-shaped risk is B's unbounded snapshot accumulation (lifecycle rule) and the calculator under-counting cold loads.

---

## 5. Memory / CPU risk of the build

### 5.1 Option A: build inside a Worker

Already analysed in 01 section 6.2-6.6; unchanged except: use `seqproto` only, never `binary`/`json` formats in the Worker (#45: `binary` added +183 MB heap on restore of the unstemmed Orama index; seqproto "noise"). Build = Hyperdrive read of 697 rows with `content_json` => plaintext, `create` + `insert` loop with stemming, `persist`, brotli (q9 vs q11). CPU limits are generous (Queue consumer default 30 s, 5 min max, 01 section 6.2); **128 MB heap is the risk**. Escape hatch is a Node builder in CI (same library, no redesign).

### 5.2 Option B: where Edge rebuilds run

- **Not in a DO.** The DO (`IndexCoordinator`) only holds the lock/WAL (`coordinator.ts:152-206`); the rebuild itself runs in the Worker request that invoked it: threshold trigger via `ctx.waitUntil` after a write, or the `scheduled` handler with `runInline: true`, or synchronous `POST /rebuild` (`worker.ts`; `api-reference.mdx:380`: "Rebuild runs synchronously in the Worker request"). External alternative: Node CLI `zbsearch-edge-builder rebuild` over S3 with R2 token (`indexing-and-rebuilds.mdx:142-168`), which has the same no-stemmer limitation.
- Limits: `cpu_ms = 300000` is set by the template (needs Paid); memory 128 MB. Docs-measured memory evidence: 8 x 16.5 MB shards in one isolate OOM at 132 MB (`benchmarks.mdx` line 130); "parallel shard rebuilds in one invocation exceed the 128MB isolate memory limit once shards grow past a few thousand documents" (`indexing-and-rebuilds.mdx:200`). Docs-measured CPU: 96k docs rebuilt in about 6 s CPU (8 shards, 1.3 KB docs, 62 us/doc).
- For 697 unstemmed docs (derived): snapshot 10-15 MB; a rebuild holds old bytes + decoded msgpack object + DB + doc Map + new DB + export + new msgpack bytes simultaneously: about 4-6x snapshot size => roughly 50-90 MB (very rough). Under 128 MB but with ~1.5-2x headroom, and #45's +183 MB figure for msgpack restore warns it could be worse. **Unmeasured; B's spike must scale the corpus 1x/2x/4x.** Failure mode is worse than A's (3.6).

### 5.3 Cross-check

Neither option has a measurement for our corpus on Workers. B's docs measurements are 1.3 KB English unstemmed documents on a laptop (`benchmarks.mdx` lines 95-110: "does not enforce the 128 MB isolate memory limit") or a production Worker for search only; rebuild CPU/memory numbers are local or from sharded 100k-doc indexes. Do not treat either as a prediction.

---

## 6. UX and SEO

### 6.1 Current state (old repo)

`/arhiv/page.tsx` is `force-dynamic`; the content is `<Search />`, a client component whose controls, table and hits are all `dynamic(..., { ssr: false })`. So today's /arhiv renders skeletons on the server; crawlers see the H1 and metadata (`title`, `description`, `canonical`) but no results. State lives in the URL via nuqs (`view`, `sort`, `author`, `year`, query). Server-rendered, no-JS search results would be new work in either option.

### 6.2 Comparison

|                                             | A: local                                                                         | B: Edge                                                                                                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Works without JS                            | No (index restored in the browser) unless a server fallback is added             | Possible: RSC page calls Edge via service binding; but needs facets/sort (patched Edge)                                                                                                                                                      |
| Linkable                                    | Yes, already via nuqs (`?q=&sort=&author=&year=`)                                | Yes, and the result can be in the HTML                                                                                                                                                                                                       |
| Cacheable through the Vinext response store | The page shell yes; results no (client-side). Artifact cached by CDN (immutable) | A per-URL result could be cached with `unstable_cache` tagged `search` and purged by `updateTag` inside the publish action (01 section 4.2); JSON-serialisable and small. Low hit rate on free-text queries; useful for default/facet views. |
| Facet/sort/histogram click latency          | <10 ms query + React render, no network                                          | One RSC navigation or fetch per click: browser RTT + Vinext Worker + Edge (+ R2 `meta.json`): docs-measured 170-450 ms e2e                                                                                                                   |
| ctrl-K per keystroke                        | local, instant after load                                                        | 100 ms debounce + 170-450 ms                                                                                                                                                                                                                 |
| First interaction                           | pays 1.4 MB + restore (mitigate by prefetch on focus)                            | no download; cold isolate risk                                                                                                                                                                                                               |
| Slow phone / data-saver                     | worst case: slow restore, 1.4 MB                                                 | best case: nothing heavy on device                                                                                                                                                                                                           |

The honest B advantage is device-independence and the option of SSR/SEO; the honest A advantage is interaction latency and independence from cold isolates.

### 6.3 Is a hybrid sensible?

Edge for ctrl-K and SSR, local for /arhiv interactions: **no.** It means two index pipelines (Postgres => WAL/rebuild in Edge and Postgres => artifact in a Queue consumer), two copies of search state that can disagree after a publish (WAL overlay is instant, artifact is delayed by the build), two stemming configurations (Edge cannot stem at all unless forked), and two sets of failure modes. The incremental UX gain (no download for ctrl-K) is small, because ctrl-K can lazy-load the same artifact the first time it opens and the artifact is browser-cached. Cheaper variants if SSR is ever wanted: run the same `zbsearch` library server-side in a Route Handler (one index, same build) as a third option (not evaluated here), or serve the first page of default-sort results (no query) as static HTML from Postgres and leave search client-only.

---

## 7. Spike design (temp branches, do not run)

Common: scratch Hyperdrive/R2/Worker names, `observability.enabled`, record `$workers.cpuTimeMs` per invocation (Workers Logs; in-Worker timers read ~0 in production, 01 section 6.5), outcome codes (`exceededCpu`, `exceededMemory`), and use the same 20 fixed queries plus "jama" (expected 487 hits on the 4.0.0 benchmark; recompute on the shipped version).

### 7.1 Spike A (branch `spike/search-local`)

Do 01 section 6.6 (build in Worker, phases, scale 1x-8x, brotli q9/q11, R2 custom domain, concurrency test), plus the pieces #45 never measured:

1. Search projection schema: `title`, `body` (searchable, stemmed, ideally not shipped to the card UI), `author_ids: "string[]"`, `year: "string"` (or `number` with ranges), `published_at: "number"`, `article_kind: "enum"`, plus the display fields cards need. Record how much display data is stored in the index (payload effect).
2. In a real browser (Chrome Android throttled 4x, and desktop): fetch, decode, restore (seqproto **and** json with chunked `loadAsync`), time to first search, long-task count (PerformanceObserver), heap.
3. Per-query timing for: plain, `facets {author_ids, year}`, each of the 4 sorts (title, author, published_at asc/desc), `tolerance: 1`, `where {article_kind}`, `limit 15/offset`. Compare hits with Node.
4. Pin and test the version actually shipped (4.0.1), without the 4.0.0 override. Test artifact/client version skew (artifact key includes lib version).

Thresholds (extending 01's table): restore <= 400 ms desktop / <= 1.2 s throttled phone, no single long task > 200 ms (or Web Worker/chunked), query incl. facets+sort+fuzzy median <= 25 ms, artifact <= 1.6 MB brotli, build CPU <= 15 s and no OOM at 4x. Effort: 01's spike (about 1 day) + 1 day for browser/feature measurements = about 2 days.

### 7.2 Spike B (branch `spike/search-edge`)

Run in this order; stop at step 1 if it fails and the fork is unacceptable.

1. **Kill test (30 min)**: deploy unmodified Edge with `zbsearch-edge-setup`, `import` 697 docs from a JSON export (schema as in 7.1, `language: slovenian`). POST search with `facets`, `sortBy`, `tolerance: 1`. Pass = response has `facets` and sorted/fuzzy behaviour; expected (from source) = all ignored. Also confirm the "slovenian" index is unstemmed by searching an inflected form.
2. Fork `edge-core` locally: forward `facets, sortBy, tolerance, threshold` in `runSearch`; inject `@zbsearch/stemmers/slovenian` in the four `create()` sites and the builder CLI; measure bundle size and startup (< 1 s). Parity with Node on the 21 queries (hit counts and top-10 order).
3. Cold/warm latency: service-bound stub route in a Vinext preview; from a machine in Slovenia fire searches at 1/min, 1/10 s and bursts of 5; record p50/p95/p99 and `cpuTimeMs`, fraction of cold isolates (first request after N minutes idle), with the Edge Worker on a custom route and on workers.dev (to see whether the Cache API layer is real).
4. Dirty-path: write 1 doc (default threshold 500), then search 20 times: CPU per search; set `REBUILD_THRESHOLD_OPS=1` and measure publish-to-fresh latency.
5. Rebuild CPU and memory: scale 1x/2x/4x/8x by duplicating docs; watch `exceededMemory`; peak during rebuild vs dirty search.
6. Failure injection: kill a rebuild (throw mid-run), check lock steal time and search behaviour while pending; check R2 old-snapshot accumulation.
7. Repopulate drill: wipe the bucket, restore via `import` from Postgres export.

Thresholds: step 1 unmodified pass = all features honoured (unlikely); fork parity = 0 mismatches; warm p50 <= 120 ms and p95 <= 300 ms measured from the browser; cold fraction < 10% at 1 search per 5 min (else the cold argument decides against B); rebuild OK at 4x; dirty search <= 250 ms CPU; publish-to-fresh <= 5 s. Effort: kill test 0.5 day; fork + parity + measurements 2-3 days; plus ongoing fork maintenance (not in the spike).

---

## 8. Recommendation

**Pick A (local client-side zbsearch), with the build in a Queue consumer + Cron as in 01 section 6.** Reasons, in order of weight:

1. B as published cannot do the required features (1.3, 1.4): no facets, no sort, no fuzzy, no Slovenian stemming. Choosing B means maintaining a fork of a beta package (about 4 `create()` sites, 1 `search()` call, plus builder), against a maintainer who ships a major version every few weeks (3.8).
2. The cold-start argument from #44 still holds (2.5): B pays a 0.3-0.6 s decode on each cold isolate (derived) plus a `meta.json` R2 read on every search, vs A's one-time 1.4 MB + restore per session and zero per-interaction cost.
3. Interaction density on /arhiv favours zero round trips (6.2).
4. A has the better operations story: failure = stale index not an outage (3.6), Postgres stays the only source of truth (3.7), logic testable in Node (3.3), no new Worker/DO/secrets.
5. Cost is a wash (4).

What B genuinely does better: no payload or CPU on the visitor's device (slow phones), instant publish visibility via the WAL overlay, optional SSR/no-JS results, built-in rebuild lock/WAL. None of these is currently a stated requirement.

**Conditions that would flip the pick to B (or to a server-side library variant):**

- Upstream Edge (or our fork, if you accept maintaining it) forwards `facets/sortBy/tolerance` and accepts a stemmer, **and** the spike measures cold-isolate fraction < 10% with warm p95 <= 300 ms.
- Spike A shows browser restore > 1.2 s on a throttled phone even with chunked `loadAsync`/a Web Worker, or the artifact grows beyond about 3 MB (corpus x2-3).
- SSR/no-JS search results become a requirement. Then prefer running the `zbsearch` library server-side (same index, same build) over Edge, because it keeps stemming and facets.
- The in-Worker build cannot fit 128 MB: that does **not** flip to B, it moves the build to the Node/GitHub Action builder (01 section 6.6 decision rule).

**Single measurement if you want to stay agnostic:** run Spike B step 1 (30 minutes). If unmodified Edge ignores `facets/sortBy/tolerance` as the source says, B is out of contention without any further work.

---

## Repos/docs needed but not available locally

- `zbsearch` git history (local clone is one shallow commit): Edge change history, test churn, how breaking changes are communicated. Used `gh release list` and `npm view` instead.
- Published `@zbsearch/runtime-cloudflare` and `@zbsearch/edge-index-builder` tarballs: I only unpacked `@zbsearch/edge-core@4.0.1`; the other two were read from the clone (package version 4.0.1 equals npm `latest`, but the contents were not diffed).
- Cloudflare statements on isolate idle time/eviction, R2-from-Worker latency, Cache API behaviour for service-bound Workers on workers.dev, and Queues' exact included operations (the pricing page is a partial I did not open).
- `@cloudflare/config` support for DO SQLite migrations and auxiliary Workers with their own R2/DO under `vp dev`.
- Real corpus and production DB (no access; `.env.local` not read): all sizes are #45's numbers; stemmed vs unstemmed index sizes for 4.0.1 are unknown.
- Browser measurements: no one has restored a zbsearch seqproto/json index in a browser in any source I found.
- `@zbsearch/static` (sharded, lazily fetched static index, `zbsearch/integrations/static.mdx`) is a possible A-variant to cut the 1.4 MB download; I did not evaluate whether it supports facets/sort/tolerance (docs say rankings are identical to `search()`).

## Top risks per option

**A, local**

1. Browser restore on slow phones and main-thread blocking (seqproto browser support UNVERIFIED; docs call it Node-oriented).
2. In-Worker build memory (128 MB) and brotli CPU; mitigated by Node builder fallback.
3. Library/artifact version skew (tokenization changed in 4.0.1; an index carries its builder's tokens): pin and key artifacts by library version.
4. zbsearch maturity (one maintainer, major releases every few weeks); same as today's accepted risk in #44.
5. Features #45 never measured (facets, sort, tolerance) and the `workspace:*`/4.0.0 override assumption are stale: re-measure on 4.0.1.

**B, Edge**

1. Missing features and stemming (fork required; permanent maintenance of a beta package).
2. Cold isolates: decode cost per cold isolate, `meta.json` R2 read per search, unverified cold share, Cache API layer likely inactive on workers.dev.
3. Dirty-search cost and the never-rebuild default (`REBUILD_THRESHOLD_OPS=500`) on a low-write site; stuck rebuild turns into search outages.
4. Memory headroom for rebuild/decode of an unstemmed 10-15 MB snapshot in 128 MB.
5. Two mutable copies of the data (Postgres and R2), no diff API, snapshot accumulation, no breaking-change policy, hard-coded `/v1/info` version.

---

## Sources

zbsearch (`~/code/repos/micheleriva/zbsearch`, 4.0.1, shallow clone):

- Edge docs: `apps/docs/content/docs/cloudflare/{index,setup,api-reference,indexing-and-rebuilds,production,local-development,benchmarks,cost-calculator}.mdx` (all read in full).
- Edge source: `packages/edge-core/src/{service,router,registry,shard-group}.ts` (+ `tests/`), `packages/runtime-cloudflare/src/{worker,coordinator,search-node,storage}.ts`, `packages/runtime-cloudflare/deploy/wrangler.monorepo.toml`, `packages/edge-index-builder/src`, `packages/storage-s3/src`; test counts via grep.
- Library docs: `apps/docs/content/docs/zbsearch/{vs-orama,search/{facets,sorting,filters,index},text-analysis/stemming,supported-languages/index,usage/serialization,plugins/plugin-data-persistence/storage-adapters,integrations/static}.mdx`; `packages/zbsearch/src/components/tokenizer/index.ts`.
- External: `gh release list/view` for `micheleriva/zbsearch` (v3.2.1 to v4.0.1), `gh issue list`, `gh api repos/micheleriva/zbsearch`, `npm view` for `@zbsearch/{edge-core,runtime-cloudflare,edge-index-builder,plugin-data-persistence,stemmers}` and `zbsearch`; unpacked `@zbsearch/edge-core@4.0.1` tarball (`dist/service.js`, `dist/shard-group.js`) for the parameter-forwarding check.

Old repo (`.references/jknm`, `89d48c2`): `src/app/arhiv/{page,search,search-controls,infinite-hits,components}.tsx`, `src/components/shell/searchbar.tsx`, `src/lib/validators.ts`, `scripts/zbsearch-bench.ts`, `docs/research/algolia-vs-orama-search.md`; GitHub issues `lukaprsina/jknm#44` (body, via `--json`) and `#45` (comments, via `--json`).

Cloudflare docs (`~/code/repos/cloudflare/cloudflare-docs/src/content/docs`): `workers/platform/{pricing,limits}.mdx`, `workers/reference/how-workers-works.mdx`, `workers/runtime-apis/cache.mdx`, `workers/runtime-apis/bindings/service-bindings/index.mdx`, `r2/pricing.mdx`, `r2/buckets/public-buckets.mdx`, `durable-objects/platform/pricing.mdx`, `queues/platform/pricing.mdx` (partial not expanded).

This repo: `docs/00_HANDOFF.md`, `docs/research/01_workers-port-unknowns.md` (sections 1, 4, 6, risks), `cloudflare.config.ts`.
