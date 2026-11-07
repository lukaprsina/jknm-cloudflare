/**
 * Step 2 of the migration (PLAN-media): which prod media rows get copied.
 * Reads the DB (a restored dump) and the thumbnail audit; writes
 * `<staging>/list.json`. Usage: vpx scripts/migrate-media/list.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { AUDIT_DIR, OLD_DATABASE_URL, STAGING_DIR } from "./config";
import { select_media } from "./plan";

const pool = new Pool({ connectionString: OLD_DATABASE_URL });

const media = await pool.query<{
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  hash: string;
  ext: string;
}>(
  `select id, filename, content_type, size_bytes, hash,
          substring(original->>'url' from '\\.(\\w+)$') as ext
     from media order by id`,
);

// Ids in prod content must all be lowercase: `media_id_of` parses lowercase only.
// Every article counts here, deleted ones too: the builder keeps them all.
const any_uppercase = await pool.query(
  `select 1 from articles where content_json::text ~ 'gradivo\\.jknm\\.org/[0-9a-f-]*[A-F]'`,
);
if (any_uppercase.rowCount) throw new Error("uppercase media ids in content");

const in_content = await pool.query<{ id: string }>(
  `select distinct m[1] as id
     from articles a,
          regexp_matches(a.content_json::text, 'gradivo\\.jknm\\.org/([0-9a-fA-F-]{36})/', 'g') as m
    where a.deleted_at is null`,
);

const live_thumbnails = await pool.query<{ id: string }>(
  `select distinct thumbnail_media_id as id from articles
    where deleted_at is null and thumbnail_media_id is not null`,
);

const used = new Set([...in_content.rows, ...live_thumbnails.rows].map(({ id }) => id));
const audit: { deletions: { media_id: string }[] } = JSON.parse(
  readFileSync(join(AUDIT_DIR, "delete-list.json"), "utf8"),
);
const replaced_thumbnails = new Set(audit.deletions.map(({ media_id }) => media_id));

const { kept, dropped } = select_media({ rows: media.rows, replaced_thumbnails, used });

// A replaced thumbnail that live content still embeds would leave a broken image.
const still_embedded = [...replaced_thumbnails].filter((id) =>
  in_content.rows.some((row) => row.id === id),
);
if (still_embedded.length > 0) throw new Error(`replaced but embedded: ${still_embedded.length}`);
if (kept.some((row) => row.content_type === "image/heif"))
  throw new Error("a kept row is image/heif (really AVIF)");

mkdirSync(STAGING_DIR, { recursive: true });
writeFileSync(join(STAGING_DIR, "list.json"), JSON.stringify(kept, null, 1));

const reasons = new Map<string, number>();
for (const reason of dropped.values()) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
const bytes = kept.reduce((sum, row) => sum + row.size_bytes, 0);
console.log(
  `${media.rows.length} rows: ${kept.length} kept (${(bytes / 1e9).toFixed(2)} GB), dropped`,
  Object.fromEntries(reasons),
);
await pool.end();
