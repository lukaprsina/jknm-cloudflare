import { asc, eq, type SQL } from "drizzle-orm";
import { PUBLIC_AUTHOR_COLUMNS } from "../author/public-shape";
import { media_id_of } from "../../lib/media-url";
import type { Db, DbTransaction } from "../db";
import { Article, ArticlesToAuthors, Media } from "../db/schema";

type ArticleRow = typeof Article.$inferSelect;

/** The single row a `.returning()` must yield. */
export function one<T>(rows: T[]): T {
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`Expected exactly one item, got ${rows.length}`);
  }
  return row;
}

/** Unwraps a lookup that must succeed. */
export function found<T>(value: T | undefined | null, what = "Article"): T {
  if (value == null) throw new Error(`${what} not found`);
  return value;
}

/**
 * Authors (ordered), slugs and thumbnail media: what every article read needs.
 * Authors are column-narrowed to the public allowlist so email and google ids
 * can never cross a server-to-client boundary from here.
 */
export const ARTICLE_RELATIONS = {
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

/** The article a revision supersedes, or `null` for a standalone article. */
export async function find_source<C extends { [K in keyof ArticleRow]?: true }>(
  tx: DbTransaction,
  supersedes_id: string | null,
  columns: C,
) {
  if (!supersedes_id) return null;
  return (
    (await tx.query.Article.findFirst({ where: eq(Article.id, supersedes_id), columns })) ?? null
  );
}

export async function soft_delete_article(tx: DbTransaction, article_id: string) {
  return one(
    await tx
      .update(Article)
      .set({ status: "deleted", deleted_at: new Date() })
      .where(eq(Article.id, article_id))
      .returning(),
  );
}

/** A crop of an image, in percent of the image, as the editor reports it. */
export interface ThumbnailCrop {
  image_url: string;
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
  };
  if (!crop) return cleared;

  const id = media_id_of(crop.image_url);
  const media =
    id && (await tx.query.Media.findFirst({ where: eq(Media.id, id), columns: { id: true } }));
  if (!media) return cleared;

  return {
    thumbnail_media_id: media.id,
    thumbnail_x: crop.x,
    thumbnail_y: crop.y,
    thumbnail_width: crop.width,
    thumbnail_height: crop.height,
  };
}

/**
 * The `articles` columns a revision starts with, copied from its source. Every
 * other column is deliberately not copied (see the classification test), so a
 * new column has to be put in one list or the other.
 */
export const REVISION_COPIED_COLUMNS = [
  "title",
  "article_kind",
  "published_at",
  "content_json",
  "excerpt",
  "thumbnail_media_id",
  "thumbnail_x",
  "thumbnail_y",
  "thumbnail_width",
  "thumbnail_height",
] as const satisfies readonly (keyof ArticleRow)[];

type CopiedColumn = (typeof REVISION_COPIED_COLUMNS)[number];

export function copied_columns(source: Pick<ArticleRow, CopiedColumn>) {
  return Object.fromEntries(
    REVISION_COPIED_COLUMNS.map((column) => [column, source[column]]),
  ) as Pick<ArticleRow, CopiedColumn>;
}
