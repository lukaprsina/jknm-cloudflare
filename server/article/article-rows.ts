import { asc, eq, sql, type SQL } from "drizzle-orm";
import { PUBLIC_AUTHOR_COLUMNS } from "../author/public-shape";
import type { Db, DbTransaction } from "../db";
import { Article, ArticlesToAuthors, Media } from "../db/schema";

export function assert_one<T>(value: T[]): asserts value is [T] {
  if (value.length !== 1) throw new Error(`Expected exactly one item, got ${value.length}`);
}

/**
 * Authors (ordered), slugs and thumbnail media: what every article read needs.
 * Authors are column-narrowed to the public allowlist so email and google ids
 * can never cross a server-to-client boundary from here.
 */
const ARTICLE_RELATIONS = {
  articles_to_authors: {
    with: { author: { columns: PUBLIC_AUTHOR_COLUMNS } },
    orderBy: asc(ArticlesToAuthors.order),
  },
  article_slugs: true,
  thumbnail_media: true,
} as const;

export function find_article_with_relations(executor: Db | DbTransaction, where: SQL) {
  return executor.query.Article.findFirst({ where, with: ARTICLE_RELATIONS });
}

export async function soft_delete_article(tx: DbTransaction, article_id: string) {
  const updated = await tx
    .update(Article)
    .set({ status: "deleted", deleted_at: new Date() })
    .where(eq(Article.id, article_id))
    .returning();
  assert_one(updated);
  return updated[0];
}

/** A crop of an image, in percent of the image, as the editor reports it. */
export interface ThumbnailCrop {
  image_url: string;
  uploaded_custom_thumbnail?: boolean;
  unit: "%";
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The thumbnail columns for a crop. The crop names its image by URL; media we
 * did not upload (an external URL) has no row and clears the thumbnail.
 */
export async function resolve_thumbnail(tx: DbTransaction, crop: ThumbnailCrop | undefined) {
  const cleared = {
    thumbnail_media_id: null,
    thumbnail_x: null,
    thumbnail_y: null,
    thumbnail_width: null,
    thumbnail_height: null,
    uploaded_custom_thumbnail: null,
  };
  if (!crop) return cleared;

  const [media] = await tx
    .select({ id: Media.id })
    .from(Media)
    .where(sql`${Media.original}->>'url' = ${crop.image_url}`)
    .limit(1);
  if (!media) return cleared;

  return {
    thumbnail_media_id: media.id,
    thumbnail_x: crop.x,
    thumbnail_y: crop.y,
    thumbnail_width: crop.width,
    thumbnail_height: crop.height,
    uploaded_custom_thumbnail: crop.uploaded_custom_thumbnail ?? null,
  };
}
