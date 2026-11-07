/**
 * Step 1 of the thumbnail audit (docs/private/PLAN-thumbnail-audit.md).
 * Writes the manifest `tools/thumbnail-match/match.py` reads: for every
 * published article with a thumbnail, the thumbnail's media row plus the
 * candidate source images of the same article (`media_to_articles` and the
 * `image` blocks of `content_json`, deduplicated, thumbnail excluded).
 * Read-only: one `READ ONLY` transaction on the DATABASE_URL in the env file.
 *
 * Usage: vpx scripts/thumbnail-audit/prepare.ts [--env .env.prod-ref]
 *          [--sample 10] [--out artifacts/thumbnail-audit/manifest.json]
 * --sample N keeps up to N articles from each group (typical 480x270, odd
 * size, crop pointing at a body image, flagged custom) for a quick prototype.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { Pool } from "pg";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: ".env.prod-ref" },
    out: { type: "string", default: "artifacts/thumbnail-audit/manifest.json" },
    sample: { type: "string" },
  },
});

const line = readFileSync(values.env!, "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1];
if (!line) throw new Error(`DATABASE_URL not found in ${values.env}`);
const url = line
  .replace(/^"|"$/g, "")
  .replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

interface MediaRow {
  id: string;
  content_type: string;
  hash: string | null;
  url: string;
  width: number;
  height: number;
}

interface ArticleRow {
  id: string;
  title: string;
  uploaded_custom_thumbnail: boolean | null;
  thumbnail_media_id: string;
  thumbnail_x: number | null;
  thumbnail_y: number | null;
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  content_json: { blocks?: { type: string; data?: { file?: { url?: string } } }[] } | null;
}

const MEDIA_COLUMNS = `m.id, m.content_type, m.hash,
  m.original->>'url' as url,
  (m.original->>'width')::int as width, (m.original->>'height')::int as height`;

const pool = new Pool({ connectionString: url });
const client = await pool.connect();
await client.query("BEGIN READ ONLY");

const articles = (
  await client.query<ArticleRow>(
    `select id, title, uploaded_custom_thumbnail, thumbnail_media_id,
            thumbnail_x, thumbnail_y, thumbnail_width, thumbnail_height, content_json
       from articles
      where status = 'published' and thumbnail_media_id is not null
      order by id`,
  )
).rows;

const linked = (
  await client.query<MediaRow & { article_id: string }>(
    `select mta.article_id, ${MEDIA_COLUMNS}
       from media_to_articles mta join media m on m.id = mta.media_id
       join articles a on a.id = mta.article_id
      where a.status = 'published' and a.thumbnail_media_id is not null`,
  )
).rows;

const block_urls = new Set<string>();
const urls_by_article = new Map<string, string[]>();
for (const article of articles) {
  const urls = (article.content_json?.blocks ?? [])
    .filter((block) => block.type === "image")
    .map((block) => block.data?.file?.url)
    .filter((u): u is string => !!u);
  urls_by_article.set(article.id, urls);
  for (const u of urls) block_urls.add(u);
}

const thumbnails = (
  await client.query<MediaRow>(
    `select ${MEDIA_COLUMNS} from media m where m.id = any($1::uuid[])`,
    [articles.map((a) => a.thumbnail_media_id)],
  )
).rows;
const by_url = (
  await client.query<MediaRow>(
    `select ${MEDIA_COLUMNS} from media m where m.original->>'url' = any($1::text[])`,
    [[...block_urls]],
  )
).rows;
await client.query("ROLLBACK");
client.release();
await pool.end();

const media_by_id = new Map(thumbnails.map((m) => [m.id, m]));
const media_by_url = new Map(by_url.map((m) => [m.url, m]));
const linked_by_article = Map.groupBy(linked, (row) => row.article_id);

const entries = articles.flatMap((article) => {
  const thumbnail = media_by_id.get(article.thumbnail_media_id);
  if (!thumbnail) return [];
  const candidates = new Map<string, MediaRow>();
  for (const row of linked_by_article.get(article.id) ?? []) candidates.set(row.id, row);
  for (const u of urls_by_article.get(article.id) ?? []) {
    const row = media_by_url.get(u);
    if (row) candidates.set(row.id, row);
  }
  candidates.delete(thumbnail.id);
  const images = [...candidates.values()].filter((m) => m.content_type.startsWith("image/"));
  const full_frame =
    article.thumbnail_x === 0 &&
    article.thumbnail_y === 0 &&
    article.thumbnail_width === 100 &&
    article.thumbnail_height === 100;
  const points_at_body = linked_by_article
    .get(article.id)
    ?.some((row) => row.id === article.thumbnail_media_id);
  const group = points_at_body
    ? "body_crop"
    : article.uploaded_custom_thumbnail
      ? "flagged_custom"
      : thumbnail.width === 480 && thumbnail.height === 270
        ? "typical"
        : "odd_size";
  return [
    {
      group,
      article_id: article.id,
      title: article.title,
      uploaded_custom_thumbnail: article.uploaded_custom_thumbnail,
      crop: {
        x: article.thumbnail_x,
        y: article.thumbnail_y,
        width: article.thumbnail_width,
        height: article.thumbnail_height,
        full_frame,
      },
      thumbnail,
      candidates: images,
    },
  ];
});

const sample = values.sample ? Number(values.sample) : null;
const chosen = sample
  ? [...Map.groupBy(entries, (e) => e.group).values()].flatMap((group) => group.slice(0, sample))
  : entries;

mkdirSync(dirname(values.out!), { recursive: true });
writeFileSync(
  values.out!,
  JSON.stringify({ generated_at: new Date().toISOString(), entries: chosen }, null, 2),
);

const counts = Object.entries(Object.groupBy(chosen, (e) => e.group)).map(
  ([g, list]) => `${g}=${list!.length}`,
);
const by_candidates = Object.entries(
  Object.groupBy(chosen, (e) => String(Math.min(e.candidates.length, 5))),
).map(([n, list]) => `${n === "5" ? "5+" : n}:${list!.length}`);
console.log(`${chosen.length} articles (${counts.join(" ")}) -> ${values.out}`);
console.log(`candidates per article: ${by_candidates.join("  ")}`);
