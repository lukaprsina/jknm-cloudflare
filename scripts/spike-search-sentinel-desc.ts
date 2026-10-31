// SPIKE (05): can authorless docs sort last in BOTH directions? Needs a second sort-only field.
//   vpx scripts/spike-search-sentinel-desc.ts /tmp/spike-search-paid/corpus-s.json
import { readFileSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import { create, insert, save, search } from "zbsearch";
import { language, stemmer } from "@zbsearch/stemmers/slovenian";
import { SCHEMA, projectRow, type CorpusRow } from "../lib/spike-search/schema";

const rows: CorpusRow[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const db = create({
  schema: { ...SCHEMA, author_desc: "string" },
  components: { tokenizer: { stemming: true, stemmer, language } } as never,
});
for (const r of rows) {
  const a = r.authors[0];
  const name = a ? `${a.last}, ${a.first}` : "";
  insert(db, { ...projectRow(r), author: a ? name : "￿", author_desc: name } as never);
}
const raw = Buffer.from(JSON.stringify(save(db)));
const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
console.log("size raw/br5 (with author_desc, body stored)", raw.length, br.length);
const { author_desc: _omit, ...BASE_SCHEMA } = SCHEMA;
const base = create({
  schema: BASE_SCHEMA,
  components: { tokenizer: { stemming: true, stemmer, language } } as never,
});
for (const r of rows) {
  const a = r.authors[0];
  const { author_desc: _d, ...p } = projectRow(r);
  insert(base, { ...p, author: a ? `${a.last}, ${a.first}` : "￿" } as never);
}
const rawB = Buffer.from(JSON.stringify(save(base)));
const brB = brotliCompressSync(rawB, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
console.log("size raw/br5 (baseline, same setup)", rawB.length, brB.length);
const idx = (hits: any[]) =>
  hits.map((h, i) => (h.document.author_desc === "" ? i : -1)).filter((i) => i >= 0);
const asc = (await search(db, {
  term: "",
  sortBy: { property: "author", order: "ASC" },
  limit: 700,
})) as any;
const dsc = (await search(db, {
  term: "",
  sortBy: { property: "author_desc", order: "DESC" },
  limit: 700,
})) as any;
console.log("ASC(author) authorless idx", idx(asc.hits).join(","));
console.log("DESC(author_desc) authorless idx", idx(dsc.hits).join(","));
console.log("jama", ((await search(db, { term: "jama" })) as any).count);
