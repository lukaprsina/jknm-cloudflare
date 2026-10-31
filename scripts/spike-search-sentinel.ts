// SPIKE (05): author sort sentinel for authorless docs. Usage:
//   vpx scripts/spike-search-sentinel.ts /tmp/spike-search-paid/corpus-s.json
import { readFileSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import { insert, save, search } from "zbsearch";
import { makeDb, projectRow, type CorpusRow } from "../lib/spike-search/schema";

const rows: CorpusRow[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const nAuthorless = rows.filter((r) => !r.authors.length).length;
const sizes = (db: unknown) => {
  const raw = Buffer.from(JSON.stringify(save(db as never)));
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
  return `${raw.length} B raw / ${br.length} B br5`;
};

async function variant(name: string, authorOf: (r: CorpusRow) => string, desc = false) {
  const db = makeDb({ stripBody: true });
  const schemaExtra = desc ? { author_desc: "string" } : {};
  void schemaExtra; // schema is fixed in makeDb; the dup field is only exercised in the `desc` variant below
  for (const r of rows) {
    const p: Record<string, unknown> = { ...projectRow(r), author: authorOf(r) };
    insert(db, p as never);
  }
  const asc = (await search(db, {
    term: "",
    sortBy: { property: "author", order: "ASC" },
    limit: 700,
  })) as any;
  const dsc = (await search(db, {
    term: "",
    sortBy: { property: "author", order: "DESC" },
    limit: 700,
  })) as any;
  const isNone = (h: any) =>
    !rows.find((r) => r.id === String(h.document.id ?? ""))?.authors?.length;
  void isNone;
  const authorless = (h: any) => h.document.author === "" || h.document.author === "￿";
  const pos = (hits: any[]) => hits.map((h, i) => (authorless(h) ? i : -1)).filter((i) => i >= 0);
  const a = pos(asc.hits);
  const d = pos(dsc.hits);
  const jama = ((await search(db, { term: "jama" })) as any).count;
  const sent = ((await search(db, { term: "￿" })) as any).count;
  console.log(
    name.padEnd(14),
    `n=${nAuthorless}`,
    `ASC authorless idx ${a[0]}..${a.at(-1)} (of ${asc.hits.length})`,
    `DESC idx ${d[0]}..${d.at(-1)}`,
    `jama=${jama} term(U+FFFF)=${sent}`,
    sizes(db),
  );
  return { asc, dsc };
}

await variant("empty (04)", (r) =>
  r.authors[0] ? `${r.authors[0].last}, ${r.authors[0].first}` : "",
);
await variant("U+FFFF", (r) =>
  r.authors[0] ? `${r.authors[0].last}, ${r.authors[0].first}` : "￿",
);
await variant("U+10FFFF", (r) =>
  r.authors[0] ? `${r.authors[0].last}, ${r.authors[0].first}` : "\u{10ffff}",
);
await variant("zzzz", (r) =>
  r.authors[0] ? `${r.authors[0].last}, ${r.authors[0].first}` : "zzzz",
);
