import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import { create_articles } from "../article/articles";
import { Article, ArticleSlug, Author, users } from "../db/schema";
import { create_test_db } from "../db/test-helpers";
import { create_published } from "./create-published";

async function setup() {
  const db = await create_test_db();
  await db.insert(users).values({ id: "admin", name: "Admin", email: "admin@jknm.si" });
  const articles = create_articles({ db, emit: () => {} });
  return { db, articles, published: create_published({ db }) };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function publish(
  { articles }: Setup,
  title: string,
  author_ids: number[] = [],
  content?: { blocks: { type: string; data: object }[] },
) {
  const draft = await articles.create({ title }, "admin");
  const { article } = await articles.publish({
    article_id: draft.id,
    article: { title, content },
    author_ids,
  });
  return article;
}

describe("by_slug", () => {
  test("serves a published article under its primary slug, in public shape", async () => {
    const ctx = await setup();
    const [member] = await ctx.db
      .insert(Author)
      .values({
        author_type: "member",
        first_name: "Ana",
        last_name: "Novak",
        email: "ana@jknm.si",
        google_id: "g-1",
      })
      .returning();
    await publish(ctx, "Čudovita jama", [member!.id]);

    const result = await ctx.published.by_slug("cudovita-jama");

    expect(result).toMatchObject({
      outcome: "found",
      slug: "cudovita-jama",
      page: {
        title: "Čudovita jama",
        thumbnail: null,
      },
    });
    if (result.outcome !== "found") throw new Error("unreachable");
    // Exact: a column added to the author row must not reach the public shape.
    expect(result.page.authors).toEqual([
      {
        id: member!.id,
        author_type: "member",
        first_name: "Ana",
        last_name: "Novak",
        display_name: "Ana Novak",
      },
    ]);
    expect(result.page.published_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test("a renamed-away slug redirects to the primary one", async () => {
    const ctx = await setup();
    const article = await publish(ctx, "Jama");
    await ctx.articles.save({
      article_id: article.id,
      article: { title: "Velika jama" },
      author_ids: [],
    });

    expect(await ctx.published.by_slug("jama")).toEqual({
      outcome: "redirect",
      slug: "velika-jama",
    });
    expect(await ctx.published.by_slug("velika-jama")).toMatchObject({ outcome: "found" });
  });

  test("a hidden article is not found under any of its slugs, never redirected", async () => {
    const ctx = await setup();
    const archived = await publish(ctx, "Jama");
    await ctx.articles.save({
      article_id: archived.id,
      article: { title: "Velika jama" },
      author_ids: [],
    });
    await ctx.articles.archive({ article_id: archived.id });
    const deleted = await publish(ctx, "Brezno");
    await ctx.articles.delete({ article_id: deleted.id });

    for (const slug of ["jama", "velika-jama", "brezno"]) {
      expect(await ctx.published.by_slug(slug)).toEqual({ outcome: "not_found" });
    }
  });

  test("a published article without a primary slug is not found", async () => {
    const ctx = await setup();
    const article = await publish(ctx, "Jama");
    await ctx.db
      .update(ArticleSlug)
      .set({ is_primary: false })
      .where(eq(ArticleSlug.article_id, article.id));

    expect(await ctx.published.by_slug("jama")).toEqual({ outcome: "not_found" });
  });

  test("a draft's slug-less article, an unknown slug and a content page are not found", async () => {
    const ctx = await setup();
    await ctx.articles.create({ title: "Osnutek" }, "admin");
    const page = await publish(ctx, "Zgodovina");
    await ctx.db.update(Article).set({ article_kind: "content" }).where(eq(Article.id, page.id));

    for (const slug of ["osnutek", "ni-je", "zgodovina", "a%b"]) {
      expect(await ctx.published.by_slug(slug)).toEqual({ outcome: "not_found" });
    }
  });
});
