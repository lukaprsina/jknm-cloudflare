# Spike: client-side search on Workers Paid (build in Worker, R2 custom domain, author sort)

Run 2026-10-31 on branch `spike/search-local` (follows report 04). Installed and latest on npm (checked 2026-10-31): zbsearch / `@zbsearch/*` 4.0.1, vinext 1.4.0, `@vinext/cloudflare` 1.3.0, vite-plus 1.4.0; workerd 1.20261019.1 locally; Chromium 156; Node 26.13. Corpus: 700 published rows (695 `article` + 5 `content`; the "697" in the brief is the 04 count of articles only), exported read-only like 04. Labels: **measured** (this run), **derived**, **UNVERIFIED**. No secrets in this file.

## Verdicts

| #   | Item                                | Verdict                                | Key number                                                                                                                                                                        |
| --- | ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Plan switch                         | **PASS**                               | `cf accounts subscriptions get` -> `rate_plan.id = workers_paid`. Deploy with `limits.cpuMs: 60000` accepted (04: error 100328 on Free). Limit enforced: see 2.                   |
| 2   | Build in one request, q5 / q9 / q11 | **PASS, all three fit**                | CPU median: q5 1.3 s, q9 2.2 s, q11 12.3 s (11.0-19.1). All `outcome: ok`. 04's "q11 does not fit" was the Free plan.                                                             |
| 2b  | Memory                              | **Better than 04 thought**             | 2x (1400 docs) and 4x (2800 docs, 34 MB json) fit; 6x dies `exceededMemory`. Ceiling is between 4x and 6x, not ~2x.                                                               |
| 3   | R2 custom domain serving            | **PASS, with one trap**                | Stored `Content-Encoding: br` served as is; gzip/identity clients get re-encoded. Edge cache only for default-cached extensions: `.bin` HIT, extensionless and `.json` `DYNAMIC`. |
| 4   | Author sort sentinel                | **Decided: `"￿"` + second sort field** | Authorless last in both directions, +5.5 KB br (measured)                                                                                                                         |
| 4b  | Version-sensitive claims            | **Unchanged**                          | vinext route still double-encodes; `restore()` trap still in source; zbsearch main = 4.0.1                                                                                        |

## 1. Plan switch (measured)

- `cf accounts subscriptions get`: `"rate_plan": {"id": "workers_paid", "public_name": "Workers Paid"}`.
- `SPIKE_SEARCH=1 SPIKE_CPU_MS=60000 vp build` then `cf deploy --prebuilt --secrets-file ...` succeeded, including the response-store worker first (`cf deploy --prebuilt --worker <rs>`; the app deploy fails with error 10143 until the service-binding target exists).
- Enforcement is real: a 4x q11 request died at `cpuTimeMs 62000, outcome exceededCpu` (limit 60000), and the docs give the default as 30 s, max 5 min (`cloudflare-docs/src/content/docs/workers/platform/limits.mdx` lines 69-110).

## 2. Build inside a Worker on Paid

Setup: scratch app `spike-tmp-search-app` (vinext + custom entry from 04), corpus from scratch R2, one POST `/spike-search/build?phase=all&q=<n>&put=0` does R2 get, JSON.parse, build 700 docs with Slovenian stemming and body stripped, `JSON.stringify(save(db))`, `node:zlib.brotliCompressSync`. CPU is `$workers.cpuTimeMs` from Workers Logs (`cf o11y telemetry query`, `scripts/spike-search-cpu.sh`). Raw JSON 6.43 MB.

| quality | CPU ms (each run)                                        | median | wall      | artifact |
| ------- | -------------------------------------------------------- | ------ | --------- | -------- |
| q5      | 879, 962, 980, 1215, 1257, 1385, 1455, 1600, 2228 (n=9)  | 1257   | 1.2-1.6 s | 1.762 MB |
| q9      | 1226, 1322, 1351, 2132, 2291, 2607, 2646, 3098 (n=8)     | ~2200  | 1.5-3.5 s | 1.663 MB |
| q11     | 11023, 11809, 12872 (with 2 R2 puts), 19097 (first, n=4) | ~12300 | 11-21 s   | 1.511 MB |

- Noise is large (same request, 0.9-2.2 s at q5); quote ranges. q11 is 5.7 s locally in 04 but 11-19 s on deployed CPU: do not extrapolate local numbers.
- **q11 fits**: 12 s median is under the 30 s default (derived from the limits doc) and under the 60 s set here. It costs ~10x the CPU of q5 for 14% fewer bytes (1.51 vs 1.76 MB). Recommendation unchanged in direction but looser: q9 is the pragmatic ceiling in the Worker (-100 KB for ~+1 s); q5 if CPU matters; q11 only if the last 250 KB matter. CPU price is negligible either way (Workers Paid CPU is billed per ms; not re-verified here).
- **Scale (memory proxy; `process.memoryUsage()` is 0 in workerd, so the only gauge is the invocation outcome):**

| corpus                      | q   | CPU ms | outcome                      | artifact |
| --------------------------- | --- | ------ | ---------------------------- | -------- |
| 2x (1400 docs, raw 15.5 MB) | 5   | 2694   | ok                           | 3.69 MB  |
| 2x                          | 11  | 29447  | ok                           | 2.68 MB  |
| 4x (2800 docs, raw 34 MB)   | 5   | 18002  | ok                           | 5.93 MB  |
| 4x                          | 11  | 62000  | **exceededCpu** (60 s limit) | -        |
| 6x                          | 5   | 13867  | **exceededMemory**           | -        |

Scaled rows duplicate documents with a suffix on every word ("uniq" mode, vocabulary grows too), so it is pessimistic for real growth. Reading: 128 MB (limits doc, `workers/platform/limits.mdx` line 124) is reached between 4x and 6x; 04's Node-heap proxy said 4x would not fit and was too pessimistic. Corpus growth is not a near-term concern (700 articles in ~14 years). q11 CPU scales superlinearly (12 s at 1x, 29 s at 2x): at 2x, q11 would hit the default 30 s.

- **Artifact is not byte-deterministic:** 14 builds of the same input gave raw sizes 6435058, 6435568 and 6435866. The content hash in the key therefore changes per build; use the published-set fingerprint (04 item 6) to decide whether to rebuild, not the hash. Cause not investigated (UNVERIFIED).
- **Queue consumer:** not run. Not trivial (handler composition is owned by the other spike). Docs: consumer wall 15 min, CPU default 30 s, configurable to 5 min via `limits.cpu_ms` (`queues/platform/limits.mdx` lines 29-57); Cron Trigger CPU 30 s (<1 h interval) or 15 min (>= 1 h) (`workers/platform/limits.mdx` line 76). The measured request path equals the consumer's compute, so the numbers above carry over (derived). A daily cron at >= 1 h interval has the 15 min CPU budget.

## 3. R2 custom domain (measured)

Scratch domain `spike-tmp-search.jknm.org` on bucket `spike-tmp-search-artifacts`. Before: listed all 17 records in the zone (incl. wildcard `*.jknm.org` A records, `gradivo.jknm.org` CNAME); only the auto-created `spike-tmp-search` CNAME (proxied, `public.r2.dev`) was added, and the zone record list is byte-identical to the start after deletion. Activation took ~1-2 min: until then Cloudflare's "CNAME Cross-User Banned" 403 page (domain status `ssl: pending, ownership: pending` right after create).

Objects uploaded by the Worker's `put` with `httpMetadata`: `contentType: application/json`, `contentEncoding: br`, `cacheControl: public, max-age=31536000, immutable`.

| request (curl, `Accept-Encoding`) | result                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `br`                              | 200, `content-encoding: br`, `content-type: application/json`, `content-length: 1511401` (the stored bytes), `cache-control: public, max-age=31536000, immutable`, `etag` strong |
| `gzip` only                       | 200, `content-encoding: gzip`, 1,965,734 B, weak etag: R2/edge re-encodes the stored br object for clients that cannot take br                                                   |
| none                              | 200, no content-encoding, 6,435,568 B (decoded)                                                                                                                                  |
| all three decode                  | sha256 of decoded body equals the raw hash in the key (measured, `.bin` object)                                                                                                  |

- So "is Content-Encoding br applied to a pre-compressed object with stored metadata": **yes**, bytes are passed through unchanged, and other clients are transcoded. No double-encoding (contrast: the ordinary vinext route, below).
- **Edge cache trap (measured):** `cf-cache-status` was `DYNAMIC` on every request for an extensionless key and for `.json` (manifest). Cause: Cloudflare caches by file extension, not MIME type, and does not cache JSON by default (`cloudflare-docs/src/content/docs/cache/concepts/default-cache-behavior.mdx` line 49; R2 note `r2/buckets/public-buckets.mdx` lines 40-42). A key ending in `.bin` (in the default list) went `MISS` then `HIT` with the same headers (`br`, immutable) and `vary: accept-encoding`; gzip and identity variants are also served from cache (`HIT`) and decode identically. Options: name the artifact `...zb4.0.1-<hash>.bin`, or add a Cache Rule "cache everything" for the hostname (not tested: it needs zone ruleset edits; UNVERIFIED).
- TTFB from the dev machine (Vienna colo, 6 curl runs): MISS 0.27 s, HIT 0.13-0.15 s; uncached R2 0.18-0.24 s. Total transfer 0.4-0.7 s for 1.7 MB. The gain is modest at this distance; the point of the cache is R2 read operations and far PoPs (derived).
- **CORS** (bucket rule: GET/HEAD, one allowed origin `http://localhost:8099`, headers `*`, `exposeHeaders: Content-Encoding, ETag, Content-Length`, max-age 3600; `cf r2 buckets cors update --force --rules '[...]'`): `access-control-allow-origin` echoes the allowed origin; preflight `OPTIONS` returns 204 with allow-methods `GET, HEAD`; a second origin (`http://localhost:8098`) gets no ACAO and the browser reports `net::ERR_FAILED ... MissingAllowOriginHeader`, also when the object is an edge `HIT` (no cross-origin leak from cache). Production needs the real origins listed (`https://www.jknm.si` and any preview host); `*` would also work for a public artifact.
- **Browser** (agent-browser Chromium 156 at `http://localhost:8099` via `scripts/spike-search-r2-probe.mjs` + `scripts/spike-search-cors-probe.html`): `fetch()` OK, `content-encoding: br` seen (exposed), CDP `encodedDataLength` 1,664,988 B (body 1,662,508 + headers) vs decoded `arrayBuffer` **6,435,058 B**, `JSON.parse` works (keys `internalDocumentIDStore, index, docs, sorting, ...`). With the HTTP cache on, the second fetch is `fromDiskCache: true, encodedDataLength 0` (immutable honoured).
- **`decodedBodySize` caveat:** `PerformanceResourceTiming` returns 0 for `encodedBodySize/decodedBodySize/transferSize` cross-origin unless the response sends `Timing-Allow-Origin`; R2 cannot set that header itself (a Response Header Transform Rule could; UNVERIFIED). Decoded size was therefore taken from the `arrayBuffer` length and the encoded size from CDP, which prove the same thing. Not a problem for the app.
- Re-check of the vinext route on the current versions (vinext 1.4.0, workerd 1.20261019): `GET /spike-search/artifact/<key>` (ordinary route, `encodeBody: "manual"` set) returns `content-encoding: br` and 1,511,421 B, which decompresses once to the 1,511,401 B brotli stream again, i.e. **still double-encoded**. The custom-entry path (`/spike-search/a/<key>`) decodes to 6,435,568 B JSON. Conclusion from 04 stands: serve from the R2 custom domain (preferred) or a custom entry.

## 4. Open items from 04

### Author sort sentinel (decided, measured)

zbsearch sorts strings with `a.localeCompare(b, getLocale(language))`, language `slovenian` -> `sl` (`zbsearch/packages/zbsearch/src/components/sorter.ts` lines 170-192, `tokenizer/languages.ts` lines 33, 110-114). Candidates under `localeCompare(.., "sl")` among 15 Slovenian/Latin/CJK/Greek names, identical in Node 26.13 (ICU 78.3) and Chromium 156 (`/tmp` harness, measured):

| sentinel                           | sorts last ascending?                                   |
| ---------------------------------- | ------------------------------------------------------- |
| `"￿"`                              | **yes**                                                 |
| `"\u{10ffff}"`                     | yes (sorts last, but 4 bytes UTF-8 and odd; not chosen) |
| `"￿￿"`                             | yes                                                     |
| `"~"`                              | no (first)                                              |
| `"zzzz"`, `"z"*20`, `"\u{10fffd}"` | no                                                      |
| `""` (04)                          | no (first)                                              |

On the real corpus, with `author: AUTHOR_LAST = "￿"` for the 9 authorless docs: ASC puts them at indices 691-699 (last); DESC puts them at 0-8 (first). `jama` still 667, and a term search for U+FFFF returns 0 hits. Cost +0.6 KB raw. Algolia puts records missing the custom-ranking attribute last in both directions (UNVERIFIED for the old replicas, not tested; old code `.references/jknm/src/lib/algoliasearch.ts` line 71 only sets `undefined`), so one field cannot reproduce it. **Decision:** add a sort-only `author_desc` (same name, `""` when authorless); ASC uses `sortBy: author`, DESC uses `sortBy: author_desc DESC`. Measured: authorless at indices 691-699 in both; json +86 KB raw, **+3.8 KB br5** (1,827,709 vs 1,823,953 with body stored; `scripts/spike-search-sentinel-desc.ts`). Implemented in `lib/spike-search/schema.ts` (`AUTHOR_LAST`, `author_desc`). Hide the field from search with `properties` or accept that author names are indexed twice (hit counts for `jama` unchanged at 667).

### Version-sensitive claims re-checked

- Versions: everything in 04 is already at latest on npm (table above). `vp outdated` lists only `cn`, `lucide-react`, `cf` (beta.21 -> beta.26); not tested on beta.26.
- zbsearch: the local clone `micheleriva/zbsearch` main is 4.0.1 (`packages/zbsearch/package.json` line 3), same as installed.
- `restore()` trap: `plugin-data-persistence/src/index.ts` lines 105-109 still `create({ schema: { __placeholder: 'string' } })` on main, so the default-tokenizer pitfall in 04 item 1 is current.
- Maintenance wording: zbsearch is by micheleriva (<https://github.com/micheleriva/zbsearch>), the actively maintained continuation of Orama by the original team. 04's "5-week-old fork" maintenance risk is **dropped**; remaining library risks are only the `restore()` default-tokenizer trap and rebuilding the artifact on every upgrade (docs say tokenization may change).
- cf CLI: `cf deploy --prebuilt` needs `vp build` first; plain `cf deploy` fails with `vite: command not found` under this repo's vp setup (measured).

## Changes to the handoff (proposed, not edited)

1. Search build in a Worker is a go on Paid: set `limits.cpuMs` (>= 30000 default is enough for q5/q9). Use q9 as the default, q5 if CPU matters; q11 works (12 s) but buys 150 KB for 10x the CPU and grows superlinearly.
2. Serve from an R2 custom domain; key must end in a default-cached extension (`.bin`) or a Cache Rule is needed, else every request is a `DYNAMIC` R2 read. Keep `Content-Encoding: br` stored metadata; set bucket CORS with the production origins and `exposeHeaders`.
3. Do not skip rebuilds by artifact hash (not deterministic); use the DB fingerprint.
4. Remove "memory headroom about 2x / 4x unlikely" from the open risks: 4x passes at q5, 6x fails.
5. Schema: `author` (ASC, `"￿"` sentinel) + `author_desc` (DESC key, `""` sentinel).
6. Drop the "5-week-old fork" risk.

## Cleanup (measured)

Deleted: Workers `spike-tmp-search-app`, `spike-tmp-search-rs` (with its Durable Object), R2 buckets `spike-tmp-search-artifacts`, `spike-tmp-search-rs-bodies` (objects deleted first), the bucket CORS rule, the custom domain `spike-tmp-search.jknm.org` (its DNS record went with it), local http servers, browser. Afterwards: no `spike-tmp-search*` Worker, bucket, Hyperdrive or DNS record; the jknm.org DNS list is identical to the start; `jknm-cloudflare`, `jknm-cloudflare-response-store`, `gradivo.jknm.org` untouched. (Resources named `spike-tmp-plumb-*` belong to another agent and were not touched.) The scratch token (`x-spike-token`) lived only in `/tmp/spike-search-paid/secrets.env`.

## Files

`scripts/spike-search-sentinel.ts`, `scripts/spike-search-sentinel-desc.ts` (sentinel checks), `scripts/spike-search-cpu.sh` (Workers Logs CPU extractor), `scripts/spike-search-r2-probe.mjs` + `scripts/spike-search-cors-probe.html` (CDP probe, edit the URL inside), `lib/spike-search/schema.ts` (sentinel + `author_desc`), `cloudflare.config.ts` (scratch names now `spike-tmp-search-*`). All spike code, deletable.
