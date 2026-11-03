/**
 * Runs every published article's stored content through `prepare_article` and
 * the block renderer, and reports what throws or falls back to `unknown`.
 * Read-only: one `READ ONLY` transaction on the DATABASE_URL in the env file.
 * Usage: vpx scripts/audit-content.ts [env_file]   (default .env.prod-ref)
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pool } from "pg";
import { ArticleBody } from "../components/article-body";
import { prepare_article } from "../lib/prepare-article";
import type { ArticleContentType } from "../server/db/schema";

const env_file = process.argv[2] ?? ".env.prod-ref";
const line = readFileSync(env_file, "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1];
if (!line) throw new Error(`DATABASE_URL not found in ${env_file}`);
const url = line
  .replace(/^"|"$/g, "")
  .replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

const pool = new Pool({ connectionString: url });
const client = await pool.connect();
await client.query("BEGIN READ ONLY");
const { rows } = await client.query<{
  id: string;
  title: string;
  content_json: ArticleContentType | null;
}>(`select id, title, content_json from articles where status = 'published'`);
await client.query("ROLLBACK");
client.release();
await pool.end();

const unknown = new Map<string, number>();
const embeds = new Map<string, number>();
const crashes: string[] = [];
const bad_blocks: string[] = [];
console.warn = () => {};

for (const row of rows) {
  const blocks = row.content_json?.blocks ?? [];
  // Block by block, so a crash names the block rather than the whole article.
  blocks.forEach((block, index) => {
    try {
      const prepared = prepare_article({ blocks: [block] });
      renderToStaticMarkup(createElement(ArticleBody, { blocks: prepared.blocks }));
      const kind = prepared.blocks[0]?.type === "unknown" && block.type;
      if (kind) unknown.set(kind, (unknown.get(kind) ?? 0) + 1);
      if (block.type === "embed") {
        const data = block.data as { service?: string; embed?: string };
        const key = `${data.service} ${prepared.blocks[0]?.type === "embed" ? "ok" : "FALLS THROUGH"} ${URL.parse(data.embed ?? "")?.pathname.split("/")[1] ?? data.embed}`;
        embeds.set(key, (embeds.get(key) ?? 0) + 1);
      }
    } catch (error) {
      bad_blocks.push(`${row.id} block ${index} (${block.type}): ${(error as Error).message}`);
    }
  });
  try {
    const { blocks: prepared } = prepare_article(row.content_json);
    renderToStaticMarkup(createElement(ArticleBody, { blocks: prepared }));
  } catch (error) {
    crashes.push(`${row.id} ${row.title}: ${(error as Error).message}`);
  }
}

console.log(
  `articles: ${rows.length}, whole-article crashes: ${crashes.length}, crashing blocks: ${bad_blocks.length}`,
);
console.log("unknown blocks by type:", Object.fromEntries(unknown));
console.log("embeds:", Object.fromEntries(embeds));
for (const message of [...crashes, ...bad_blocks].slice(0, 30)) console.log(" ", message);
