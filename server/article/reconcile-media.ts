import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbTransaction } from "../db";
import { Media, MediaToArticles, type ArticleContentType } from "../db/schema";
import { media_urls_in_content } from "./content-media";

/**
 * Makes `media_to_articles` mirror the media an article's content references.
 * Editor blocks only carry the media URL, so each URL is resolved back to a
 * `media` row through `original->>'url'`; URLs with no row (external images)
 * are skipped. The diff is minimal: re-saving unchanged content writes nothing.
 */
export async function reconcile_media_to_articles(
  tx: DbTransaction,
  article_id: string,
  content: ArticleContentType | null | undefined,
) {
  const urls = media_urls_in_content(content);

  const url_to_media_id = new Map<string, string>();
  if (urls.length > 0) {
    const rows = await tx
      .select({ id: Media.id, url: sql<string>`${Media.original}->>'url'` })
      .from(Media)
      .where(inArray(sql`${Media.original}->>'url'`, urls));
    for (const row of rows) url_to_media_id.set(row.url, row.id);
  }

  const desired = new Map<string, number>(); // media_id -> order
  for (const url of urls) {
    const media_id = url_to_media_id.get(url);
    if (media_id && !desired.has(media_id)) desired.set(media_id, desired.size);
  }

  const current = new Map(
    (
      await tx
        .select({ media_id: MediaToArticles.media_id, order: MediaToArticles.order })
        .from(MediaToArticles)
        .where(eq(MediaToArticles.article_id, article_id))
    ).map((row) => [row.media_id, row.order]),
  );

  const to_insert = [...desired].filter(([id]) => !current.has(id));
  const to_update = [...desired].filter(
    ([id, order]) => current.has(id) && current.get(id) !== order,
  );
  const to_delete = [...current.keys()].filter((id) => !desired.has(id));

  if (to_insert.length > 0) {
    await tx
      .insert(MediaToArticles)
      .values(to_insert.map(([media_id, order]) => ({ article_id, media_id, order })));
  }
  for (const [media_id, order] of to_update) {
    await tx
      .update(MediaToArticles)
      .set({ order })
      .where(
        and(eq(MediaToArticles.article_id, article_id), eq(MediaToArticles.media_id, media_id)),
      );
  }
  if (to_delete.length > 0) {
    await tx
      .delete(MediaToArticles)
      .where(
        and(
          eq(MediaToArticles.article_id, article_id),
          inArray(MediaToArticles.media_id, to_delete),
        ),
      );
  }
}
