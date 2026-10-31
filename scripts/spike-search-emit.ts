// SPIKE: emit raw json artifact + brotli/gzip quality table locally. vpx scripts/spike-search-emit.ts corpus-lean.json out.json
import { readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { save } from "zbsearch";
import { buildDb, type CorpusRow } from "../lib/spike-search/schema";
const rows: CorpusRow[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const json = Buffer.from(JSON.stringify(save(buildDb(rows, { stripBody: true }))));
writeFileSync(process.argv[3]!, json);
console.log("raw", json.length);
for (const q of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
  const t = performance.now();
  const n = brotliCompressSync(json, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: q,
      [constants.BROTLI_PARAM_SIZE_HINT]: json.length,
    },
  }).length;
  console.log("brotli q" + q, n, (performance.now() - t).toFixed(0) + "ms");
}
for (const l of [1, 6, 9]) {
  const t = performance.now();
  const n = gzipSync(json, { level: l }).length;
  console.log("gzip L" + l, n, (performance.now() - t).toFixed(0) + "ms");
}
