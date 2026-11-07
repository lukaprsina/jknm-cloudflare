/**
 * Step 5 of the migration (PLAN-media): turns a restored prod dump into the database
 * the new code reads. Run it on a fresh restore, once.
 *
 *  - the old `media` table is replaced by the new one (DDL from `schema.ts` through `drizzle-kit push`,
 *    rows from `manifest.json`, `created_at` kept)
 *  - thumbnails follow the audit: the 661 in `mapping.json` become their source
 *    image plus a crop, the 34 in `decisions.json` keep their pre-cropped file
 *    (no crop, or `trim` would crop twice), a thumbnail whose row was not
 *    migrated becomes null
 *  - `media_to_articles` is rebuilt for every article
 *  - the schema must end up with nothing left for `push` to change
 *
 * Usage: DATABASE_URL=postgres://… vpx scripts/migrate-media/build-db.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { reconcile_media_to_articles } from "../../server/article/reconcile-media";
import * as schema from "../../server/db/schema";
import { AUDIT_DIR, STAGING_DIR, type ManifestEntry } from "./config";

const database_url = process.env.DATABASE_URL;
if (!database_url) throw new Error("Missing DATABASE_URL");

// This drops and rebuilds tables: only ever on a restored copy, never on prod.
const { hostname } = new URL(database_url);
if (!["localhost", "127.0.0.1"].includes(hostname) && process.env.ALLOW_REMOTE_DB !== hostname) {
  throw new Error(
    `${hostname} is not local: rerun with ALLOW_REMOTE_DB=${hostname} if it is a restored copy`,
  );
}

const read_json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const manifest: ManifestEntry[] = read_json(join(STAGING_DIR, "manifest.json"));
const mapping: { article_id: string; source_media_id: string; rect_pct: number[] }[] = read_json(
  join(AUDIT_DIR, "mapping.json"),
);
const decisions: Record<string, string> = read_json(join(AUDIT_DIR, "decisions.json"));
const migrated = new Set(manifest.map((entry) => entry.id));

const pool = new Pool({ connectionString: database_url });
const db = drizzle(pool, { schema });
const rows = async <T>(query: ReturnType<typeof sql>) =>
  (await db.execute(query)).rows as unknown as T[];

/** `react-image-crop` percent rectangle, clamped to the image. */
function crop_columns([x, y, width, height]: number[]) {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    thumbnail_x: round(left),
    thumbnail_y: round(top),
    thumbnail_width: round(Math.min(100, x + width) - left),
    thumbnail_height: round(Math.min(100, y + height) - top),
  };
}

/** `drizzle-kit push` against DATABASE_URL, the way the project keeps its schema. */
function push(...flags: string[]) {
  return execFileSync("node_modules/.bin/drizzle-kit", ["push", ...flags], {
    encoding: "utf8",
    env: process.env,
  });
}

// 1. The old media rows must cover the manifest; remember what the new rows need.
const old_media = await rows<{
  id: string;
  created_at: Date;
  width: number | null;
  height: number | null;
}>(
  sql`select id, created_at, (original->>'width')::int as width, (original->>'height')::int as height from media`,
);
const old_by_id = new Map(old_media.map((row) => [row.id, row]));
let rotated = 0;
for (const entry of manifest) {
  const old = old_by_id.get(entry.id);
  if (!old) throw new Error(`${entry.id} is not in the old media table`);
  if (entry.width === null) continue;
  if (entry.width === old.width && entry.height === old.height) continue;
  // The only allowed difference: orientation 5-8 swapped the size.
  if (entry.width !== old.height || entry.height !== old.width) {
    throw new Error(
      `${entry.id}: ${entry.width}x${entry.height} vs old ${old.width}x${old.height}`,
    );
  }
  rotated++;
}

// 2. Park the thumbnails (in memory: an extra table would confuse `push`), then
// take the old table and its foreign keys away.
const parked = await rows<{
  article_id: string;
  status: string;
  thumbnail_media_id: string;
  thumbnail_x: number | null;
  thumbnail_y: number | null;
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  uploaded_custom_thumbnail: boolean | null;
}>(sql`select id as article_id, status, thumbnail_media_id, thumbnail_x, thumbnail_y,
         thumbnail_width, thumbnail_height, uploaded_custom_thumbnail
    from articles where thumbnail_media_id is not null`);
await db.execute(sql`update articles set thumbnail_media_id = null, thumbnail_x = null,
  thumbnail_y = null, thumbnail_width = null, thumbnail_height = null
  where thumbnail_media_id is not null`);
await db.execute(sql`delete from media_to_articles`);
await db.execute(sql`drop table media cascade`);

// 3. The new schema, from schema.ts.
push("--force");

// 4. The new media rows.
await db.execute(sql`insert into media
    (id, ext, filename, content_type, size_bytes, sha256, width, height, thumbhash, created_at)
  select m.id, m.ext, m.filename, m.content_type, m.size_bytes, m.sha256, m.width, m.height,
         m.thumbhash, o.created_at
    from jsonb_to_recordset(${JSON.stringify(manifest)}::jsonb) as m(
      id uuid, ext text, filename text, content_type text, size_bytes int, sha256 text,
      width int, height int, thumbhash text)
    join (select * from jsonb_to_recordset(${JSON.stringify(
      old_media.map(({ id, created_at }) => ({ id, created_at })),
    )}::jsonb) as o(id uuid, created_at timestamptz)) o using (id)`);

// 5. Thumbnails.
const mapped = new Map(mapping.map((entry) => [entry.article_id, entry]));
const tally: Record<string, number> = {};
const dropped_by_status: Record<string, number> = {};
for (const old of parked) {
  const kind = mapped.has(old.article_id)
    ? "mapped"
    : decisions[old.article_id] === "keep"
      ? "kept as is"
      : old.uploaded_custom_thumbnail
        ? "other, custom file"
        : "other";
  let thumbnail_media_id: string | null = old.thumbnail_media_id;
  let crop: Partial<ReturnType<typeof crop_columns>> = {
    thumbnail_x: old.thumbnail_x ?? undefined,
    thumbnail_y: old.thumbnail_y ?? undefined,
    thumbnail_width: old.thumbnail_width ?? undefined,
    thumbnail_height: old.thumbnail_height ?? undefined,
  };
  const entry = mapped.get(old.article_id);
  if (entry) {
    thumbnail_media_id = entry.source_media_id;
    crop = crop_columns(entry.rect_pct);
  } else if (kind !== "other") {
    crop = {}; // a pre-cropped file
  }
  if (!migrated.has(thumbnail_media_id)) {
    thumbnail_media_id = null;
    crop = {};
    dropped_by_status[old.status] = (dropped_by_status[old.status] ?? 0) + 1;
  }
  if (thumbnail_media_id === null && old.status !== "deleted") {
    throw new Error(`${old.article_id} (${old.status}) lost its thumbnail`);
  }
  tally[kind] = (tally[kind] ?? 0) + 1;
  await db
    .update(schema.Article)
    .set({ thumbnail_media_id, ...crop })
    .where(sql`${schema.Article.id} = ${old.article_id}`);
}

// 6. media_to_articles for every article.
const articles = await db
  .select({
    id: schema.Article.id,
    content: schema.Article.content_json,
    thumbnail_media_id: schema.Article.thumbnail_media_id,
  })
  .from(schema.Article);
for (const article of articles) {
  await db.transaction((tx) =>
    reconcile_media_to_articles(tx, article.id, article.content, article.thumbnail_media_id),
  );
}

// 7. Nothing left over.
if (!push().includes("No changes detected")) throw new Error("schema differs from schema.ts");
const checks = await rows<{ conname: string }>(
  sql`select conname from pg_constraint where conrelid = 'media'::regclass and conname = 'media_has_both_sizes'`,
);
if (checks.length !== 1) throw new Error("media_has_both_sizes is missing");
console.log({
  media: manifest.length,
  rotated,
  thumbnails: tally,
  "thumbnails set to null, by article status": dropped_by_status,
  articles: articles.length,
});
await pool.end();
