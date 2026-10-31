import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SPIKE_DATABASE_URL });
await c.connect();
let t = performance.now();
const r = await c.query(
  `select a.id,a.title,a.article_kind,a.published_at,a.content_json->'blocks' as blocks from articles a where a.status='published'`,
);
console.log(
  "rows",
  r.rows.length,
  "ms",
  (performance.now() - t).toFixed(0),
  "bytes~",
  JSON.stringify(r.rows).length,
);
t = performance.now();
const m = await c.query(
  `select max(updated_at) as m, count(*) as n from articles where status='published'`,
);
console.log("fingerprint query ms", (performance.now() - t).toFixed(0));
await c.end();
