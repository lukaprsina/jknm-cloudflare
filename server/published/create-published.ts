import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { excerpt_of } from "../../lib/excerpt";
import { strip_html_to_text } from "../../lib/inline-html";
import { to_public_author, type PublicAuthorView } from "../author/public-shape";
import { ARTICLE_RELATIONS, find_article_with_relations } from "../article/article-rows";
import type { Db } from "../db";
import { Article, ArticleSlug, type ArticleContentType, type ArticleKind } from "../db/schema";

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
  thumbnail: { url: string; width: number; height: number } | null;
}

export type SlugResult =
  | { outcome: "found"; slug: string; page: PublishedPage }
  /** `slug` is the primary one the caller should send the visitor to. */
  | { outcome: "redirect"; slug: string }
  | { outcome: "not_found" };

export type ContentPageResult =
  | { outcome: "found"; page: PublishedPage }
  | { outcome: "not_found" };

/** A news article as a homepage card. */
export interface FeedCard {
  id: string;
  /** The primary slug. */
  slug: string;
  title: string;
  excerpt: string;
  published_at: string;
  authors: PublicAuthorView[];
  thumbnail: { url: string; width: number; height: number } | null;
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

const NOT_FOUND = { outcome: "not_found" } as const;

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
    const original = article.thumbnail_media?.original;
    return {
      title: strip_html_to_text(article.title),
      excerpt: excerpt_of(article.content_json),
      content: article.content_json,
      published_at: article.published_at?.toISOString() ?? null,
      modified_at: article.updated_at.toISOString(),
      authors: article.articles_to_authors.map(({ author }) => to_public_author(author)),
      thumbnail: original
        ? { url: original.url, width: original.width, height: original.height }
        : null,
    };
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
        columns: { id: true, title: true, content_json: true, published_at: true },
        extras: (article) => ({
          cursor_at: sql<string>`${article.published_at}::text`.as("cursor_at"),
        }),
        with: {
          article_slugs: { where: eq(ArticleSlug.is_primary, true), columns: { slug: true } },
          articles_to_authors: ARTICLE_RELATIONS.articles_to_authors,
          thumbnail_media: { columns: { original: true } },
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
          thumbnail: row.thumbnail_media
            ? {
                url: row.thumbnail_media.original.url,
                width: row.thumbnail_media.original.width,
                height: row.thumbnail_media.original.height,
              }
            : null,
        })),
        next_cursor:
          rows.length > limit && last ? { published_at: last.cursor_at, id: last.id } : null,
      };
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
      const page = hit && (await load_page(hit.article_id));
      return page ? { outcome: "found", page } : NOT_FOUND;
    },
  };
}

export type Published = ReturnType<typeof create_published>;
