// SPIKE: full rebuild vs incremental (restore + update 1 doc + re-save). Node timings.
import { readFileSync } from "node:fs";
import { save, load, update, search } from "zbsearch";
import { buildDb, makeDb, projectRow, type CorpusRow } from "../lib/spike-search/schema";
const rows: CorpusRow[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const raw = readFileSync(process.argv[3]!, "utf8");
const T = async <R>(f: () => R | Promise<R>) => {
  const t = performance.now();
  const r = await f();
  return [r, +(performance.now() - t).toFixed(0)] as const;
};
const [db, tBuild] = await T(() => buildDb(rows, { stripBody: true }));
const [, tSave] = await T(() => JSON.stringify(save(db)));
const [d2, tRestore] = await T(() => {
  const d = makeDb({ stripBody: true });
  load(d, JSON.parse(raw));
  return d;
});
const r0: any = await search(d2, { term: "jama", limit: 1 });
const id = r0.hits[0].id;
const edited = projectRow({ ...rows[0]!, blocks: ["Nova vsebina o brezni"] });
const [, tUpd] = await T(() => update(d2, id, edited as any));
const [, tSave2] = await T(() => JSON.stringify(save(d2)));
console.log({
  fullBuildMs: tBuild,
  saveStringifyMs: tSave,
  restoreMs: tRestore,
  updateOneMs: tUpd,
  resaveMs: tSave2,
  incrementalTotalMs: tRestore + tUpd + tSave2,
  fullTotalMs: tBuild + tSave,
});
const t = performance.now();
const pgRows = rows.map((r) => r.blocks.map((b) => b.replace(/<[^>]*>/g, "")).join("\n"));
void pgRows;
console.log("extract ms", (performance.now() - t).toFixed(0));
