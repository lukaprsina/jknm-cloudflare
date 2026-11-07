import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { excerpt_of } from "../../lib/excerpt";
import { media_url, type Crop, type PageMedia } from "../../lib/media-url";
import { PG_INT_MAX } from "../../lib/legacy-si-paths";
import { strip_html_to_text } from "../../lib/inline-html";
import { to_public_author, type PublicAuthorView } from "../author/public-shape";
import { ARTICLE_RELATIONS, find_article_with_relations } from "../article/article-rows";
import type { Db } from "../db";
import {
  Article,
  ArticleSlug,
  Media,
  MediaToArticles,
  type ArticleContentType,
  type ArticleKind,
} from "../db/schema";

/** The article's cover: the whole stored image and the part of it a card shows. */
export interface Thumbnail {
  url: string;
  width: number;
  height: number;
  thumbhash: string | null;
  crop: Crop | null;
}

/** An article as the public sees it: plain serializable data, no private author fields. */
export interface PublishedPage {
  /** Plain text: some stored titles still carry editor markup. */
  title: string;
  excerpt: string;
  content: ArticleContentType | null;
  /** ISO date; null only for rows that were never dated. */
  published_at: string | null;
  modified_at: string;
  authors: PublicAuthorView[];
  thumbnail: Thumbnail | null;
  /** The images its content uses, by media id (see `prepare_article`). */
  media: PageMedia;
}

export type SlugResult =
  | { outcome: "found"; slug: string; page: PublishedPage }
  /** `slug` is the primary one the caller should send the visitor to. */
  | { outcome: "redirect"; slug: string }
  | { outcome: "not_found" };

export type ContentPageResult =
  | { outcome: "found"; page: PublishedPage }
  | { outcome: "not_found" };

export type LegacyIdResult = { outcome: "found"; slug: string } | { outcome: "not_found" };

/** A news article as a homepage card. */
export interface FeedCard {
  id: string;
  /** The primary slug. */
  slug: string;
  title: string;
  excerpt: string;
  published_at: string;
  authors: PublicAuthorView[];
  thumbnail: Thumbnail | null;
}

/** Opaque to callers; plain data so it survives a server action. */
export interface FeedCursor {
  /** Postgres text form, so microseconds survive (a `Date` keeps only milliseconds). */
  published_at: string;
  id: string;
}

export interface FeedPage {
  cards: FeedCard[];
  /** Pass as `after` for the next page; `null` when this was the last. */
  next_cursor: FeedCursor | null;
}

/** A news article as the sitemap lists it. */
export interface SitemapEntry {
  /** The primary slug. */
  slug: string;
  /** ISO date. `updated_at` is not used: backfills moved it for nearly every old article. */
  published_at: string;
}

const NOT_FOUND = { outcome: "not_found" } as const;

const THUMBNAIL_COLUMNS = {
  thumbnail_x: true,
  thumbnail_y: true,
  thumbnail_width: true,
  thumbnail_height: true,
} as const;
const THUMBNAIL_MEDIA_COLUMNS = {
  id: true,
  ext: true,
  width: true,
  height: true,
  thumbhash: true,
} as const;

type ThumbnailRow = {
  thumbnail_x: number | null;
  thumbnail_y: number | null;
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  thumbnail_media: {
    id: string;
    ext: string;
    width: number | null;
    height: number | null;
    thumbhash: string | null;
  } | null;
};

/** Null when there is no thumbnail or it is not an image. The crop columns are all set or all null. */
function thumbnail_of(row: ThumbnailRow): Thumbnail | null {
  const { thumbnail_media: media, thumbnail_x: x, thumbnail_y: y } = row;
  if (!media || media.width === null || media.height === null) return null;
  const { thumbnail_width: width, thumbnail_height: height } = row;
  return {
    url: media_url(media),
    width: media.width,
    height: media.height,
    thumbhash: media.thumbhash,
    crop:
      x !== null && y !== null && width !== null && height !== null
        ? { x, y, width, height }
        : null,
  };
}

/**
 * Everything the public may see of the articles, and under which URL. The one
 * place that decides visibility: a `published` article of the wanted kind that
 * has a primary slug, nothing else, for everyone (ADR-0001).
 */
export function create_published({ db }: { db: Db }) {
  // Uncorrelated on purpose: drizzle's relational `where` rewrites column
  // references to the root alias, which would break a correlated EXISTS.
  // A function, not a value: the ambient `db` may only be touched inside a query.
  const is_published = (kind: ArticleKind) =>
    and(
      eq(Article.status, "published"),
      // News and content pages live at their own routes; serving one at the other's would duplicate it.
      eq(Article.article_kind, kind),
      inArray(
        Article.id,
        db
          .select({ id: ArticleSlug.article_id })
          .from(ArticleSlug)
          .where(eq(ArticleSlug.is_primary, true)),
      ),
    );

  async function load_page(article_id: string): Promise<PublishedPage | null> {
    const article = await find_article_with_relations(db, eq(Article.id, article_id));
    if (!article) return null;
    return {
      title: strip_html_to_text(article.title),
      excerpt: excerpt_of(article.content_json),
      content: article.content_json,
      published_at: article.published_at?.toISOString() ?? null,
      modified_at: article.updated_at.toISOString(),
      authors: article.articles_to_authors.map(({ author }) => to_public_author(author)),
      thumbnail: thumbnail_of(article),
      media: await images_of(article_id),
    };
  }

  /** Display size and placeholder of every image the article links; rows that are not images are left out. */
  async function images_of(article_id: string): Promise<PageMedia> {
    const rows = await db
      .select({
        id: Media.id,
        width: Media.width,
        height: Media.height,
        thumbhash: Media.thumbhash,
      })
      .from(MediaToArticles)
      .innerJoin(Media, eq(Media.id, MediaToArticles.media_id))
      .where(eq(MediaToArticles.article_id, article_id));
    return Object.fromEntries(
      rows.flatMap(({ id, width, height, thumbhash }) =>
        width === null || height === null ? [] : [[id, { width, height, thumbhash }]],
      ),
    );
  }

  return {
    /** Newest first; publish-date ties are broken by id so pages never overlap or skip. */
    async feed({ limit, after }: { limit: number; after?: FeedCursor }): Promise<FeedPage> {
      const rows = await db.query.Article.findMany({
        where: and(
          is_published("article"),
          after &&
            sql`(${Article.published_at}, ${Article.id}) < (${after.published_at}::timestamptz, ${after.id}::uuid)`,
        ),
        orderBy: [desc(Article.published_at), desc(Article.id)],
        limit: limit + 1,
        columns: {
          id: true,
          title: true,
          content_json: true,
          published_at: true,
          ...THUMBNAIL_COLUMNS,
        },
        extras: (article) => ({
          cursor_at: sql<string>`${article.published_at}::text`.as("cursor_at"),
        }),
        with: {
          article_slugs: { where: eq(ArticleSlug.is_primary, true), columns: { slug: true } },
          articles_to_authors: ARTICLE_RELATIONS.articles_to_authors,
          thumbnail_media: { columns: THUMBNAIL_MEDIA_COLUMNS },
        },
      });

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        cards: page.map((row) => ({
          id: row.id,
          slug: row.article_slugs[0]!.slug,
          title: strip_html_to_text(row.title),
          excerpt: excerpt_of(row.content_json),
          published_at: row.published_at!.toISOString(),
          authors: row.articles_to_authors.map(({ author }) => to_public_author(author)),
          thumbnail: thumbnail_of(row),
        })),
        next_cursor:
          rows.length > limit && last ? { published_at: last.cursor_at, id: last.id } : null,
      };
    },

    /** Every published news article, newest first, so the output is stable. */
    async sitemap_entries(): Promise<SitemapEntry[]> {
      const rows = await db
        .select({ slug: ArticleSlug.slug, published_at: Article.published_at })
        .from(Article)
        .innerJoin(
          ArticleSlug,
          and(eq(ArticleSlug.article_id, Article.id), eq(ArticleSlug.is_primary, true)),
        )
        .where(is_published("article"))
        .orderBy(desc(Article.published_at), desc(Article.id));
      return rows.map((row) => ({ slug: row.slug, published_at: row.published_at!.toISOString() }));
    },

    /** Visibility is decided before canonicality, so a hidden article's old slug is `not_found`. */
    async by_slug(requested: string): Promise<SlugResult> {
      const primary_slug = alias(ArticleSlug, "primary_slug");
      const [hit] = await db
        .select({ article_id: Article.id, primary: primary_slug.slug })
        .from(ArticleSlug)
        .innerJoin(Article, eq(Article.id, ArticleSlug.article_id))
        .innerJoin(
          primary_slug,
          and(eq(primary_slug.article_id, Article.id), eq(primary_slug.is_primary, true)),
        )
        .where(and(eq(ArticleSlug.slug, requested), is_published("article")));
      if (!hit) return NOT_FOUND;
      if (hit.primary !== requested) return { outcome: "redirect", slug: hit.primary };

      // Only a served article pays for the full load; junk slugs stop above.
      const page = await load_page(hit.article_id);
      // Unpublished between the two queries.
      return page ? { outcome: "found", slug: hit.primary, page } : NOT_FOUND;
    },

    /**
     * Old `www.jknm.si/si/?id=` links. The slug is the primary one; a route builds the path.
     * An id outside Postgres `integer` is `not_found` here, because the driver would throw.
     */
    async by_legacy_id(legacy_id: number): Promise<LegacyIdResult> {
      if (!Number.isInteger(legacy_id) || legacy_id < 0 || legacy_id > PG_INT_MAX) return NOT_FOUND;
      const [hit] = await db
        .select({ slug: ArticleSlug.slug })
        .from(ArticleSlug)
        .innerJoin(Article, eq(Article.id, ArticleSlug.article_id))
        .where(
          and(
            eq(Article.legacy_id, legacy_id),
            eq(ArticleSlug.is_primary, true),
            is_published("article"),
          ),
        );
      return hit ? { outcome: "found", slug: hit.slug } : NOT_FOUND;
    },

    /** Only the primary slug counts: an alias of a content page is not a route, so it never redirects. */
    async by_content_page(slug: string): Promise<ContentPageResult> {
      const [hit] = await db
        .select({ article_id: Article.id })
        .from(ArticleSlug)
        .innerJoin(Article, eq(Article.id, ArticleSlug.article_id))
        .where(
          and(
            eq(ArticleSlug.slug, slug),
            eq(ArticleSlug.is_primary, true),
            is_published("content"),
          ),
        );
      // Null when unpublished between the two queries.
      const page = hit && (await load_page(hit.article_id));
      return page ? { outcome: "found", page } : NOT_FOUND;
    },
  };
}

export type Published = ReturnType<typeof create_published>;
