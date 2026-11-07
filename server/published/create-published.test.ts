import { eq, sql } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import { CONTENT_PAGES } from "../../lib/content-pages";
import { create_articles } from "../article/articles";
import { Article, ArticleSlug, Author, users } from "../db/schema";
import { create_test_db, insert_media } from "../db/test-helpers";
import { create_published, type FeedCursor } from "./create-published";

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
    expect(result.page.modified_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test("the page title is plain text even when the stored title has markup", async () => {
    const ctx = await setup();
    await publish(ctx, "Jama <b>pri</b>&nbsp;mostu");
    const result = await ctx.published.by_slug("jama-pri-mostu");
    expect(result).toMatchObject({ outcome: "found", page: { title: "Jama pri mostu" } });
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

describe("images", () => {
  const image_block = (url: string) => ({
    type: "image",
    data: { file: { url, width: 1, height: 1 }, caption: "" },
  });

  test("a page carries the media rows of the images it uses, and its thumbnail with the crop", async () => {
    const ctx = await setup();
    const body = await insert_media(ctx.db, { width: 800, height: 600, thumbhash: "AAAA" });
    const cover = await insert_media(ctx.db, { width: 2000, height: 1500, thumbhash: "BBBB" });
    const draft = await ctx.articles.create({ title: "Jama" }, "admin");
    await ctx.articles.publish({
      article_id: draft.id,
      article: {
        title: "Jama",
        content: { blocks: [image_block(body.url)] },
        thumbnail_crop: { image_url: cover.url, unit: "%", x: 10, y: 20, width: 50, height: 28 },
      },
      author_ids: [],
    });

    const result = await ctx.published.by_slug("jama");

    if (result.outcome !== "found") throw new Error("unreachable");
    // The thumbnail's media is linked too, which is harmless: the map is only looked up by block URL.
    expect(result.page.media).toEqual({
      [body.id]: { width: 800, height: 600, thumbhash: "AAAA" },
      [cover.id]: { width: 2000, height: 1500, thumbhash: "BBBB" },
    });
    expect(result.page.thumbnail).toEqual({
      url: cover.url,
      width: 2000,
      height: 1500,
      thumbhash: "BBBB",
      crop: { x: 10, y: 20, width: 50, height: 28 },
    });
  });

  test("a feed card carries the same thumbnail", async () => {
    const ctx = await setup();
    const cover = await insert_media(ctx.db, { width: 2000, height: 1500 });
    const draft = await ctx.articles.create({ title: "Jama" }, "admin");
    await ctx.articles.publish({
      article_id: draft.id,
      article: {
        title: "Jama",
        thumbnail_crop: { image_url: cover.url, unit: "%", x: 0, y: 0, width: 100, height: 56 },
      },
      author_ids: [],
    });

    const { cards } = await ctx.published.feed({ limit: 5 });

    expect(cards[0]!.thumbnail).toEqual({
      url: cover.url,
      width: 2000,
      height: 1500,
      thumbhash: null,
      crop: { x: 0, y: 0, width: 100, height: 56 },
    });
  });

  test("a thumbnail that is not an image has none", async () => {
    const ctx = await setup();
    const pdf = await insert_media(ctx.db, { ext: "pdf", width: null, height: null });
    const draft = await ctx.articles.create({ title: "Jama" }, "admin");
    await ctx.articles.publish({
      article_id: draft.id,
      article: {
        title: "Jama",
        thumbnail_crop: { image_url: pdf.url, unit: "%", x: 0, y: 0, width: 100, height: 56 },
      },
      author_ids: [],
    });

    const { cards } = await ctx.published.feed({ limit: 5 });

    expect(cards[0]!.thumbnail).toBeNull();
  });
});

describe("by_content_page", () => {
  /** Publishes an article titled `title` and turns it into a content page. */
  async function publish_content(ctx: Setup, title: string) {
    const page = await publish(ctx, title);
    await ctx.db.update(Article).set({ article_kind: "content" }).where(eq(Article.id, page.id));
    return page;
  }

  test.each(CONTENT_PAGES)("serves $title at /$slug", async ({ slug, title }) => {
    const ctx = await setup();
    await publish_content(ctx, title);

    expect(await ctx.published.by_content_page(slug)).toMatchObject({
      outcome: "found",
      page: { title },
    });
  });

  test("a content page without a primary slug is not found", async () => {
    const ctx = await setup();
    const page = await publish_content(ctx, "Klub");
    await ctx.db
      .update(ArticleSlug)
      .set({ is_primary: false })
      .where(eq(ArticleSlug.article_id, page.id));

    expect(await ctx.published.by_content_page("klub")).toEqual({ outcome: "not_found" });
  });

  test("a news article that took the reserved slug is not a content page", async () => {
    const ctx = await setup();
    await publish(ctx, "Klub");

    expect(await ctx.published.by_content_page("klub")).toEqual({ outcome: "not_found" });
  });

  test("a hidden content page is not found", async () => {
    const ctx = await setup();
    await ctx.articles.create({ title: "Varstvo" }, "admin");
    const archived = await publish_content(ctx, "Klub");
    await ctx.articles.archive({ article_id: archived.id });
    const deleted = await publish_content(ctx, "Zgodovina");
    await ctx.articles.delete({ article_id: deleted.id });

    for (const slug of ["varstvo", "klub", "zgodovina"]) {
      expect(await ctx.published.by_content_page(slug)).toEqual({ outcome: "not_found" });
    }
  });

  test("an alias of a content page is not found, never redirected", async () => {
    const ctx = await setup();
    const page = await publish_content(ctx, "Klub");
    await ctx.db.insert(ArticleSlug).values({ article_id: page.id, slug: "stari-klub" });

    expect(await ctx.published.by_content_page("stari-klub")).toEqual({ outcome: "not_found" });
  });
});

describe("by_legacy_id", () => {
  async function publish_with_legacy_id(ctx: Setup, title: string, legacy_id: number) {
    const article = await publish(ctx, title);
    await ctx.db.update(Article).set({ legacy_id }).where(eq(Article.id, article.id));
    return article;
  }

  test("finds a published article by its legacy id, under the primary slug", async () => {
    const ctx = await setup();
    const article = await publish_with_legacy_id(ctx, "Jama", 42);
    await ctx.articles.save({
      article_id: article.id,
      article: { title: "Velika jama" },
      author_ids: [],
    });

    expect(await ctx.published.by_legacy_id(42)).toEqual({ outcome: "found", slug: "velika-jama" });
  });

  test("a hidden article, a content page and an unknown id are not found", async () => {
    const ctx = await setup();
    await ctx.articles
      .create({ title: "Osnutek" }, "admin")
      .then(({ id }) => ctx.db.update(Article).set({ legacy_id: 1 }).where(eq(Article.id, id)));
    await ctx.articles.archive({
      article_id: (await publish_with_legacy_id(ctx, "Arhiv", 2)).id,
    });
    await ctx.articles.delete({
      article_id: (await publish_with_legacy_id(ctx, "Brisano", 3)).id,
    });
    const page = await publish_with_legacy_id(ctx, "Klub", 4);
    await ctx.db.update(Article).set({ article_kind: "content" }).where(eq(Article.id, page.id));

    for (const id of [1, 2, 3, 4, 5]) {
      expect(await ctx.published.by_legacy_id(id)).toEqual({ outcome: "not_found" });
    }
  });

  test("a published article without a primary slug is not found", async () => {
    const ctx = await setup();
    const article = await publish_with_legacy_id(ctx, "Jama", 7);
    await ctx.db
      .update(ArticleSlug)
      .set({ is_primary: false })
      .where(eq(ArticleSlug.article_id, article.id));

    expect(await ctx.published.by_legacy_id(7)).toEqual({ outcome: "not_found" });
  });

  test("the legacy id follows a retitled revision to its new slug", async () => {
    const ctx = await setup();
    const source = await publish_with_legacy_id(ctx, "Jama", 9);
    const draft = await ctx.articles.create_superseding_draft({ article_id: source.id }, "admin");
    await ctx.articles.publish({
      article_id: draft.id,
      article: { title: "Velika jama" },
      author_ids: [],
    });

    expect(await ctx.published.by_legacy_id(9)).toEqual({ outcome: "found", slug: "velika-jama" });
  });

  // Postgres `integer` overflows past this; the driver would throw (a 500) instead of a not-found.
  test.each([-1, 1.5, 2_147_483_648, Number.NaN])(
    "an out-of-range id %s is not found",
    async (id) => {
      const { published } = await setup();
      expect(await published.by_legacy_id(id)).toEqual({ outcome: "not_found" });
    },
  );
});

describe("feed", () => {
  /** Publishes articles and pins their dates (Postgres text, so microseconds are expressible). */
  async function seed(ctx: Setup, dated: Record<string, string>) {
    for (const [title, at] of Object.entries(dated)) {
      const article = await publish(ctx, title);
      await ctx.db
        .update(Article)
        .set({ published_at: sql`${at}::timestamptz` })
        .where(eq(Article.id, article.id));
    }
  }

  /** Follows the cursor to the end; every page must be non-empty and within `limit`. */
  async function titles_by_page({ published }: Setup, limit: number) {
    const pages: string[][] = [];
    let after: FeedCursor | undefined;
    do {
      const page = await published.feed({ limit, after });
      pages.push(page.cards.map((card) => card.title));
      after = page.next_cursor ?? undefined;
    } while (after);
    return pages;
  }

  test("lists published news newest first, with its primary slug and thumbnail data", async () => {
    const ctx = await setup();
    await seed(ctx, { Stara: "2026-01-01 10:00+00", Nova: "2026-02-01 10:00+00" });

    const { cards, next_cursor } = await ctx.published.feed({ limit: 10 });

    expect(cards.map((card) => [card.title, card.slug])).toEqual([
      ["Nova", "nova"],
      ["Stara", "stara"],
    ]);
    expect(cards[0]).toMatchObject({ published_at: "2026-02-01T10:00:00.000Z", thumbnail: null });
    expect(next_cursor).toBeNull();
  });

  test("cards and pages carry the same teaser, derived from the content", async () => {
    const ctx = await setup();
    await publish(ctx, "Jama", [], {
      blocks: [{ type: "paragraph", data: { text: "Globoka <i>jama</i>." } }],
    });

    const [card] = (await ctx.published.feed({ limit: 1 })).cards;
    const found = await ctx.published.by_slug("jama");

    expect(card?.excerpt).toBe("Globoka jama.");
    expect(found.outcome === "found" && found.page.excerpt).toBe("Globoka jama.");
  });

  test("cards carry the authors in byline order, in public shape", async () => {
    const ctx = await setup();
    const authors = await ctx.db
      .insert(Author)
      .values([
        { author_type: "guest", first_name: "Ana", last_name: "Novak" },
        { author_type: "guest", first_name: "Bor", last_name: "Zupan" },
      ])
      .returning();
    await publish(ctx, "Jama", authors.map((author) => author.id).reverse());

    const [card] = (await ctx.published.feed({ limit: 1 })).cards;

    expect(card?.authors.map((author) => author.display_name)).toEqual(["Bor Zupan", "Ana Novak"]);
  });

  test("leaves out drafts, archived and deleted articles and content pages", async () => {
    const ctx = await setup();
    await seed(ctx, { Objavljena: "2026-01-01 10:00+00" });
    await ctx.articles.create({ title: "Osnutek" }, "admin");
    const archived = await publish(ctx, "Arhivirana");
    await ctx.articles.archive({ article_id: archived.id });
    const deleted = await publish(ctx, "Izbrisana");
    await ctx.articles.delete({ article_id: deleted.id });
    const page = await publish(ctx, "Zgodovina");
    await ctx.db.update(Article).set({ article_kind: "content" }).where(eq(Article.id, page.id));

    const { cards } = await ctx.published.feed({ limit: 10 });

    expect(cards.map((card) => card.title)).toEqual(["Objavljena"]);
  });

  test("is empty when nothing is published", async () => {
    const ctx = await setup();
    expect(await ctx.published.feed({ limit: 10 })).toEqual({ cards: [], next_cursor: null });
  });

  test("has a next page only when more rows remain", async () => {
    const ctx = await setup();
    await seed(ctx, {
      A: "2026-01-01 10:00+00",
      B: "2026-01-02 10:00+00",
      C: "2026-01-03 10:00+00",
    });

    expect((await ctx.published.feed({ limit: 2 })).next_cursor).not.toBeNull();
    expect((await ctx.published.feed({ limit: 3 })).next_cursor).toBeNull();
    expect((await ctx.published.feed({ limit: 4 })).next_cursor).toBeNull();
  });

  test("pages never overlap or skip, across ties and microsecond-apart dates", async () => {
    const ctx = await setup();
    await seed(ctx, {
      Tie1: "2026-01-01 10:00:00+00",
      Tie2: "2026-01-01 10:00:00+00",
      Tie3: "2026-01-01 10:00:00+00",
      Micro1: "2026-01-02 10:00:00.000001+00",
      Micro2: "2026-01-02 10:00:00.000002+00",
      Old: "2025-12-31 10:00:00+00",
    });

    for (const limit of [1, 2, 4]) {
      const flat = (await titles_by_page(ctx, limit)).flat();
      expect(flat.slice(0, 2)).toEqual(["Micro2", "Micro1"]);
      expect(flat.slice(2, 5).toSorted()).toEqual(["Tie1", "Tie2", "Tie3"]);
      expect(flat[5]).toBe("Old");
      expect(flat).toHaveLength(6);
    }
  });
});

describe("sitemap_entries", () => {
  test("lists each published news article once, under its primary slug and publish date", async () => {
    const ctx = await setup();
    const renamed = await publish(ctx, "Jama");
    await ctx.articles.save({
      article_id: renamed.id,
      article: { title: "Velika jama" },
      author_ids: [],
    });
    await ctx.db
      .update(Article)
      .set({ published_at: sql`'2026-01-01 10:00+00'::timestamptz` })
      .where(eq(Article.id, renamed.id));
    // Everything below is not public news.
    await ctx.articles.create({ title: "Osnutek" }, "admin");
    const archived = await publish(ctx, "Arhivirana");
    await ctx.articles.archive({ article_id: archived.id });
    const deleted = await publish(ctx, "Izbrisana");
    await ctx.articles.delete({ article_id: deleted.id });
    const page = await publish(ctx, "Zgodovina");
    await ctx.db.update(Article).set({ article_kind: "content" }).where(eq(Article.id, page.id));
    const slugless = await publish(ctx, "Brez");
    await ctx.db
      .update(ArticleSlug)
      .set({ is_primary: false })
      .where(eq(ArticleSlug.article_id, slugless.id));

    expect(await ctx.published.sitemap_entries()).toEqual([
      { slug: "velika-jama", published_at: "2026-01-01T10:00:00.000Z" },
    ]);
  });
});
