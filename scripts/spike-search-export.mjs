// Spike: read-only export of published articles to a local JSON file (path in argv[2]).
// Run via scripts/spike-env.sh. Only SELECTs. Prints counts only.
import pg from "pg";
import { writeFileSync } from "node:fs";
import sanitizeHtml from "sanitize-html";
import { decode } from "html-entities";

const c = new pg.Client({ connectionString: process.env.SPIKE_DATABASE_URL });
await c.connect();
const { rows } = await c.query(`
  select a.id, a.title, a.article_kind, a.published_at, a.updated_at,
    (a.thumbnail_media_id is not null) as has_thumbnail,
    a.content_json->'blocks' as blocks,
    (select slug from article_slugs s where s.article_id=a.id order by is_primary desc, id limit 1) as slug,
    coalesce((select json_agg(json_build_object('id',au.id,'first',au.first_name,'last',au.last_name) order by x."order")
       from articles_to_authors x join author au on au.id=x.author_id where x.article_id=a.id),'[]'::json) as authors
  from articles a where a.status='published' order by a.published_at`);
await c.end();
const ALLOWED = ["paragraph", "list", "quote"];
const strip = (h) => decode(sanitizeHtml(h, { allowedTags: [] })).trim();
const out = rows.map((r) => {
  const blocks = (r.blocks ?? [])
    .filter((b) => ALLOWED.includes(b.type))
    .map((b) => b.data?.text ?? "");
  return {
    id: r.id,
    title: r.title,
    kind: r.article_kind,
    slug: r.slug ?? "",
    published_at: r.published_at ? r.published_at.getTime() : 0,
    has_thumbnail: r.has_thumbnail,
    authors: r.authors,
    blocks, // raw html per block (Worker strips itself)
    text_ref: blocks.map(strip).join("\n"), // old-repo extraction, for equivalence checks
  };
});
writeFileSync(process.argv[2], JSON.stringify(out));
const kinds = {};
for (const o of out) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
console.log(
  "rows",
  out.length,
  kinds,
  "noPublishedAt",
  out.filter((o) => !o.published_at).length,
  "noAuthor",
  out.filter((o) => !o.authors.length).length,
  "noSlug",
  out.filter((o) => !o.slug).length,
  "textBytes",
  out.reduce((s, o) => s + Buffer.byteLength(o.text_ref), 0),
);
