import { eq } from "drizzle-orm";
import type { Db, DbTransaction } from "../db";
import { Article, ArticlesToAuthors, type ArticleContentType } from "../db/schema";
import type { Emit } from "../events";
import {
  assert_one,
  find_article_with_relations,
  resolve_thumbnail,
  type ThumbnailCrop,
} from "./article-rows";
import { reconcile_media_to_articles } from "./reconcile-media";

export interface ArticleInput {
  title: string;
  content?: ArticleContentType | null;
  thumbnail_crop?: ThumbnailCrop;
  published_at?: Date;
}

async function replace_article_authors(
  tx: DbTransaction,
  article_id: string,
  author_ids: number[],
) {
  await tx.delete(ArticlesToAuthors).where(eq(ArticlesToAuthors.article_id, article_id));
  if (author_ids.length === 0) return;
  await tx
    .insert(ArticlesToAuthors)
    .values(author_ids.map((author_id, index) => ({ article_id, author_id, order: index })));
}

export function create_articles({ db, emit }: { db: Db; emit: Emit }) {
  return {
    async create(input: { title: string }, actor_id: string) {
      const created = await db
        .insert(Article)
        .values({
          title: input.title,
          status: "draft",
          content_json: {
            blocks: [{ type: "header", data: { text: input.title, level: 1 } }],
          },
          created_by: actor_id,
        })
        .returning();
      assert_one(created);
      await emit("article.created");
      return created[0];
    },

    /**
     * Saves a draft. `published_at` doubles as "the date this piece is or will
     * be published", so a picked date survives closing the editor. Omitted
     * content leaves the stored content alone.
     */
    async save(input: { article_id: string; article: ArticleInput; author_ids: number[] }) {
      const saved = await db.transaction(async (tx) => {
        const existing = await tx.query.Article.findFirst({
          where: eq(Article.id, input.article_id),
          columns: { published_at: true },
        });
        if (!existing) throw new Error("Article not found");

        const thumbnail = await resolve_thumbnail(tx, input.article.thumbnail_crop);
        const updated = await tx
          .update(Article)
          .set({
            title: input.article.title,
            content_json: input.article.content ?? undefined,
            published_at: input.article.published_at ?? existing.published_at ?? new Date(),
            ...thumbnail,
          })
          .where(eq(Article.id, input.article_id))
          .returning();
        assert_one(updated);

        await replace_article_authors(tx, input.article_id, input.author_ids);
        // Reconcile against the persisted content, not the input: an omitted
        // `content` leaves the stored one in place, and keying off the input
        // would wipe every link on a content-less save.
        await reconcile_media_to_articles(tx, input.article_id, updated[0].content_json);
        return find_article_with_relations(tx, eq(Article.id, input.article_id));
      });
      await emit("article.saved");
      return saved;
    },
  };
}
