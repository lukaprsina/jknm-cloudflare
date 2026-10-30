// SPIKE: Node feature check. Usage: vpx scripts/spike-search-node.ts /tmp/spike-search/corpus.json
import { readFileSync } from "node:fs";
import { search, save, load, create } from "zbsearch";
import { persist, restore } from "@zbsearch/plugin-data-persistence";
import { tokenizer as tokComp } from "zbsearch/components";
import { stemmer, language } from "@zbsearch/stemmers/slovenian";
import { buildDb, makeDb, htmlToText, type CorpusRow } from "../lib/spike-search/schema";

const rows: CorpusRow[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
let mism = 0;
for (const r of rows) {
  const mine = r.blocks.map(htmlToText).join("\n");
  if (mine !== r.text_ref) mism++;
}
console.log("regex/html-entities vs sanitize-html text mismatches:", mism, "of", rows.length);

let t = performance.now();
const db = buildDb(rows);
console.log("build ms", (performance.now() - t).toFixed(0));
const dbUn = buildDb(rows, { stemming: false });

const q = async (d: any, p: any) => (await search(d, p)) as any;
for (const term of [
  "jama",
  "jame",
  "jamo",
  "jami",
  "jamah",
  "jamarji",
  "jamar",
  "brezno",
  "Jama",
]) {
  const a = await q(db, { term, limit: 5 });
  const b = await q(dbUn, { term, limit: 5 });
  const c = await q(db, { term, limit: 5, properties: ["title", "body"] });
  console.log(
    term.padEnd(8),
    "stemmed",
    a.count,
    "stemmed(title,body)",
    c.count,
    "unstemmed",
    b.count,
  );
}

const base = { term: "jama", limit: 10, properties: ["title", "body"] };
const f = await q(db, { ...base, facets: { author_ids: { limit: 100 }, year: {} } });
console.log(
  "facets author_ids n=",
  Object.keys(f.facets.author_ids.values).length,
  "count",
  f.facets.author_ids.count,
  "year",
  JSON.stringify(f.facets.year.values).slice(0, 200),
);
const sorts: [string, "ASC" | "DESC"][] = [
  ["published_at", "ASC"],
  ["published_at", "DESC"],
  ["title", "ASC"],
  ["title", "DESC"],
  ["author", "ASC"],
  ["author", "DESC"],
];
for (const [property, order] of sorts) {
  t = performance.now();
  const r = await q(db, { ...base, sortBy: { property, order } });
  const ms = performance.now() - t;
  console.log(
    "sort",
    property,
    order,
    r.count,
    ms.toFixed(1) + "ms",
    r.hits.slice(0, 3).map((h: any) => (h.document[property] ?? "").toString().slice(0, 22)),
  );
}
const typo = await q(db, { term: "jamma", limit: 5, properties: ["title", "body"], tolerance: 1 });
console.log(
  "tolerance1 'jamma'",
  typo.count,
  "tol0",
  (await q(db, { term: "jamma", properties: ["title", "body"] })).count,
);
const w = await q(db, { ...base, where: { article_kind: { eq: "article" } } });
console.log(
  "where kind=article",
  w.count,
  "kind=content",
  (await q(db, { ...base, where: { article_kind: { eq: "content" } } })).count,
  "published_at>=2020",
  (await q(db, { ...base, where: { published_at: { gte: Date.UTC(2020, 0, 1) } } })).count,
  "year=2019 (string where)",
  await q(db, { ...base, where: { year: "2019" } }).then(
    (x: any) => x.count,
    (e: any) => "ERR " + e.message.slice(0, 60),
  ),
  "exact jama",
  (await q(db, { term: "jama", exact: true, properties: ["title", "body"] })).count,
);
const p1 = await q(db, { ...base, limit: 15, offset: 0 }),
  p2 = await q(db, { ...base, limit: 15, offset: 15 });
console.log(
  "pagination",
  p1.hits.length,
  p2.hits.length,
  "overlap",
  p1.hits.filter((h: any) => p2.hits.some((x: any) => x.id === h.id)).length,
);
// 2 ctrl-K queries
const ck = await q(db, {
  term: "jama",
  limit: 3,
  where: { article_kind: { eq: "content" } },
  properties: ["title", "body"],
});
console.log("ctrlK content hits", ck.count);
// empty term (browse all, /arhiv default view)
const all = await q(db, {
  term: "",
  limit: 15,
  sortBy: { property: "published_at", order: "DESC" },
  facets: { year: {}, author_ids: { limit: 100 } },
});
console.log("empty term count", all.count, "hit0", all.hits[0]?.document.title?.slice(0, 40));

// formats
console.log("--- formats");
for (const format of ["json", "seqproto"] as const) {
  t = performance.now();
  const ser: any = await persist(db, format);
  const pms = performance.now() - t;
  const bytes = typeof ser === "string" ? Buffer.from(ser) : Buffer.from(ser);
  const { brotliCompressSync, gzipSync, constants } = await import("node:zlib");
  const br = brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }).length;
  const gz = gzipSync(bytes).length;
  global.gc?.();
  const h0 = process.memoryUsage().heapUsed;
  t = performance.now();
  const r1: any = await restore(format, ser);
  const rms = performance.now() - t;
  const h1 = process.memoryUsage().heapUsed;
  const same = async (d: any, label: string) => {
    const probes: any[] = [
      { term: "jama", limit: 10 },
      { ...base, facets: { author_ids: { limit: 100 }, year: {} } },
      { ...base, sortBy: { property: "published_at", order: "DESC" } },
      { ...base, sortBy: { property: "title", order: "ASC" } },
      { ...base, sortBy: { property: "author", order: "DESC" } },
      { ...base, where: { article_kind: { eq: "article" } } },
      { term: "jame", limit: 10 },
    ];
    const out: string[] = [];
    for (const p of probes) {
      let a: any, b: any;
      try {
        a = await q(db, p);
        b = await q(d, p);
      } catch (e: any) {
        out.push("ERR:" + e.message.slice(0, 50));
        continue;
      }
      const sig = (x: any) =>
        JSON.stringify([x.count, x.hits.map((h: any) => h.id).join(","), x.facets ?? null]);
      out.push(sig(a) === sig(b) ? "=" : `DIFF(${a.count}/${b.count})`);
    }
    console.log(`  ${format} via plugin restore() [${label}] vs fresh:`, out.join(" "));
  };
  console.log(
    format,
    "raw",
    bytes.length,
    "gzip",
    gz,
    "brotli11",
    br,
    "persist ms",
    pms.toFixed(0),
    "restore ms",
    rms.toFixed(0),
    "heap+",
    ((h1 - h0) / 1e6).toFixed(1) + "MB",
  );
  await same(r1, "default tokenizer");
  r1.tokenizer = await tokComp.createTokenizer({ stemming: true, stemmer, language });
  await same(r1, "tokenizer patched to Slovenian");
}
// json restored into a properly-configured db (documented save/load path)
const raw = JSON.parse(JSON.stringify(save(db)));
const d2 = makeDb();
load(d2, raw);
for (const term of ["jame", "jama"])
  console.log("json load() into stemmer-configured db", term, (await q(d2, { term })).count);
const d3: any = await restore("json", JSON.stringify(save(db)));
for (const term of ["jame", "jama"])
  console.log("plugin restore() default tokenizer", term, (await q(d3, { term })).count);
