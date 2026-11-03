import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { strip_html_to_text } from "../../lib/inline-html";
import { to_public_author, type PublicAuthorView } from "../author/public-shape";
import { find_article_with_relations, found } from "../article/article-rows";
import type { Db } from "../db";
import { Article, ArticleSlug, type ArticleContentType } from "../db/schema";

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

const NOT_FOUND = { outcome: "not_found" } as const;

/**
 * Everything the public may see of the articles, and under which URL. The one
 * place that decides visibility: a `published` news article that has a primary
 * slug, nothing else, for everyone (ADR-0001).
 */
export function create_published({ db }: { db: Db }) {
  // Uncorrelated on purpose: drizzle's relational `where` rewrites column
  // references to the root alias, which would break a correlated EXISTS.
  // A function, not a value: the ambient `db` may only be touched inside a query.
  const is_published = () =>
    and(
      eq(Article.status, "published"),
      // Content pages live at their own routes; serving them here too would duplicate them.
      eq(Article.article_kind, "article"),
      inArray(
        Article.id,
        db
          .select({ id: ArticleSlug.article_id })
          .from(ArticleSlug)
          .where(eq(ArticleSlug.is_primary, true)),
      ),
    );

  return {
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
        .where(and(eq(ArticleSlug.slug, requested), is_published()));
      if (!hit) return NOT_FOUND;
      if (hit.primary !== requested) return { outcome: "redirect", slug: hit.primary };

      // Only a served article pays for the full load; junk slugs stop above.
      const article = found(await find_article_with_relations(db, eq(Article.id, hit.article_id)));
      const original = article.thumbnail_media?.original;
      return {
        outcome: "found",
        slug: hit.primary,
        page: {
          title: strip_html_to_text(article.title),
          excerpt: article.excerpt ?? "",
          content: article.content_json,
          published_at: article.published_at?.toISOString() ?? null,
          modified_at: article.updated_at.toISOString(),
          authors: article.articles_to_authors.map(({ author }) => to_public_author(author)),
          thumbnail: original
            ? { url: original.url, width: original.width, height: original.height }
            : null,
        },
      };
    },
  };
}

export type Published = ReturnType<typeof create_published>;
