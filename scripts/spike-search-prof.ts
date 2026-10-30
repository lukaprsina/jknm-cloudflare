import { readFileSync } from "node:fs";
import { search } from "zbsearch";
import { buildDb } from "/home/luka/code/js/jknm-cloudflare/lib/spike-search/schema";
const db = buildDb(JSON.parse(readFileSync("/tmp/spike-search/corpus-lean.json", "utf8")), {
  stripBody: true,
});
const med = async (p: any) => {
  const t: number[] = [];
  for (let i = 0; i < 20; i++) {
    const s = performance.now();
    await search(db, p);
    t.push(performance.now() - s);
  }
  return t.sort((a, b) => a - b)[10]!.toFixed(1);
};
const b = { term: "", limit: 15 };
console.log("empty", await med(b));
console.log(
  "empty+sort pub",
  await med({ ...b, sortBy: { property: "published_at", order: "DESC" } }),
);
console.log("empty+facet year", await med({ ...b, facets: { year: {} } }));
console.log("empty+facet author_ids", await med({ ...b, facets: { author_ids: { limit: 100 } } }));
console.log(
  "term jama+facets both",
  await med({ term: "jama", limit: 15, facets: { year: {}, author_ids: { limit: 100 } } }),
);
console.log("empty+where kind", await med({ ...b, where: { article_kind: { eq: "article" } } }));
const pr = { properties: ["title", "body"], limit: 15 };
console.log("empty+props", await med({ term: "", ...pr }));
console.log(
  "empty+props+sort",
  await med({ term: "", ...pr, sortBy: { property: "published_at", order: "DESC" } }),
);
console.log(
  "empty+props+facets",
  await med({ term: "", ...pr, facets: { year: {}, author_ids: { limit: 100 } } }),
);
console.log(
  "empty+props+sort+facets",
  await med({
    term: "",
    ...pr,
    sortBy: { property: "published_at", order: "DESC" },
    facets: { year: {}, author_ids: { limit: 100 } },
  }),
);
