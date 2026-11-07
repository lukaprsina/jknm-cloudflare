import { and, eq, inArray } from "drizzle-orm";
import { media_id_of } from "../../lib/media-url";
import type { DbTransaction } from "../db";
import { Media, MediaToArticles, type ArticleContentType } from "../db/schema";
import { media_urls_in_content } from "./content-media";

/**
 * Makes `media_to_articles` mirror the media an article uses: what its content
 * references (each URL names its `media` id), then its thumbnail, so the orphan
 * sweep needs only this table. Ids with no row (external images, deleted media)
 * are skipped. The diff is minimal: re-saving unchanged content writes nothing.
 */
export async function reconcile_media_to_articles(
  tx: DbTransaction,
  article_id: string,
  content: ArticleContentType | null | undefined,
  thumbnail_media_id: string | null,
) {
  const wanted = new Set(media_urls_in_content(content).map(media_id_of));
  wanted.delete(null);
  if (thumbnail_media_id) wanted.add(thumbnail_media_id);

  const existing =
    wanted.size === 0
      ? []
      : await tx
          .select({ id: Media.id })
          .from(Media)
          .where(inArray(Media.id, [...wanted] as string[]));
  const existing_ids = new Set(existing.map((row) => row.id));
  const desired = new Map<string, number>(); // media_id -> order
  for (const id of wanted) if (id && existing_ids.has(id)) desired.set(id, desired.size);

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
