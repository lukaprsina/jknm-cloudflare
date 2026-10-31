// SPIKE: artifact built by zbsearch 4.0.0 loaded by 4.0.1 (version skew).
import { readFileSync } from "node:fs";
import { load, search } from "zbsearch";
import { makeDb } from "../lib/spike-search/schema";
const d = makeDb();
load(d, JSON.parse(readFileSync("/tmp/spike-search/v400.json", "utf8")));
for (const term of ["jama", "jame", "brezno"])
  console.log(term, ((await search(d, { term })) as any).count);
console.log(
  "sort ok",
  ((await search(d, { term: "jama", sortBy: { property: "title" }, limit: 1 })) as any).hits[0]
    .document.title,
);
