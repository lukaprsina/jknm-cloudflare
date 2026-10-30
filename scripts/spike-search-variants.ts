// SPIKE: artifact size by projection variant. vpx scripts/spike-search-variants.ts corpus.json
import { readFileSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import { save, search, load } from "zbsearch";
import { buildDb, makeDb, type CorpusRow } from "../lib/spike-search/schema";
const rows: CorpusRow[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const br = (b: Buffer, quality = 11) =>
  brotliCompressSync(b, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: quality,
      [constants.BROTLI_PARAM_SIZE_HINT]: b.length,
    },
  }).length;
for (const [name, opts] of [
  ["baseline (body stored)", {}],
  ["body NOT stored", { stripBody: true }],
  ["unstemmed", { stemming: false }],
] as const) {
  const db = buildDb(rows, opts as any);
  const json = Buffer.from(JSON.stringify(save(db)));
  const t = performance.now();
  const raw = JSON.parse(json.toString());
  const d2 = makeDb(opts as any);
  load(d2, raw);
  const ms = performance.now() - t;
  const n = ((await search(d2, { term: "jama", properties: ["title", "body"] })) as any).count;
  console.log(
    name.padEnd(24),
    "json",
    json.length,
    "br11",
    br(json),
    "br9",
    br(json, 9),
    "restore",
    ms.toFixed(0) + "ms",
    "jama hits",
    n,
  );
}
