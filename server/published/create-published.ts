import { eq } from "drizzle-orm";
import { strip_html_to_text } from "../../lib/inline-html";
import { to_public_author, type PublicAuthorView } from "../author/public-shape";
import { find_article_with_relations } from "../article/article-rows";
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
 * place that decides visibility: a `published` news article, nothing else, for
 * everyone (ADR-0001).
 */
export function create_published({ db }: { db: Db }) {
  return {
    /** Visibility is decided before canonicality, so a hidden article's old slug is `not_found`. */
    async by_slug(requested: string): Promise<SlugResult> {
      const slug_row = await db.query.ArticleSlug.findFirst({
        where: eq(ArticleSlug.slug, requested),
        columns: { article_id: true },
      });
      if (!slug_row) return NOT_FOUND;

      const article = await find_article_with_relations(db, eq(Article.id, slug_row.article_id));
      // Content pages live at their own routes; serving them here too would duplicate them.
      if (article?.status !== "published" || article.article_kind !== "article") return NOT_FOUND;

      const primary = article.article_slugs.find((slug) => slug.is_primary)?.slug;
      if (!primary) return NOT_FOUND;
      if (primary !== requested) return { outcome: "redirect", slug: primary };

      const original = article.thumbnail_media?.original;
      return {
        outcome: "found",
        slug: primary,
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
