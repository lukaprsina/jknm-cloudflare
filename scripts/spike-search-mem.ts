// SPIKE: Node proxy for isolate memory. Run per scale in a child with --max-old-space-size.
// vpx scripts/spike-search-mem.ts corpus-lean.json <scale>
import { readFileSync } from "node:fs";
import { save } from "zbsearch";
import { buildDb, scaleRows, type CorpusRow } from "../lib/spike-search/schema";
const rows = scaleRows(
  JSON.parse(readFileSync(process.argv[2]!, "utf8")) as CorpusRow[],
  Number(process.argv[3]),
  "uniq",
);
const m = () => {
  const u = process.memoryUsage();
  return +((u.heapUsed + u.arrayBuffers) / 1e6).toFixed(0);
};
const t0 = performance.now();
const db = buildDb(rows, { stripBody: true });
const a = m();
const raw = save(db);
const b = m();
const text = JSON.stringify(raw);
const c = m();
const bytes = new TextEncoder().encode(text);
console.log(
  JSON.stringify({
    scale: process.argv[3],
    docs: rows.length,
    afterBuildMB: a,
    afterSaveMB: b,
    afterStringifyMB: c,
    afterEncodeMB: m(),
    rawBytes: bytes.length,
    ms: Math.round(performance.now() - t0),
  }),
);
