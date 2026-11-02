import { describe, expect, test } from "vite-plus/test";
import { eq } from "drizzle-orm";
import type { DomainEvent } from "../../lib/cache-policy";
import { create_test_db } from "../db/test-helpers";
import { Article, Author, Media, MediaToArticles, users } from "../db/schema";
import { create_articles } from "./articles";

async function setup() {
  const db = await create_test_db();
  await db.insert(users).values({ id: "admin", name: "Admin", email: "admin@jknm.si" });
  const events: DomainEvent[] = [];
  const articles = create_articles({ db, emit: (event) => void events.push(event) });
  return { db, events, articles };
}

describe("create", () => {
  test("starts a draft headed by its title, attributed to the actor", async () => {
    const { articles, events } = await setup();

    const draft = await articles.create({ title: "Nova jama" }, "admin");

    expect(draft.status).toBe("draft");
    expect(draft.title).toBe("Nova jama");
    expect(draft.created_by).toBe("admin");
    expect(draft.content_json?.blocks[0]).toMatchObject({
      type: "header",
      data: { text: "Nova jama", level: 1 },
    });
    expect(events).toEqual(["article.created"]);
  });
});

async function add_authors(db: Awaited<ReturnType<typeof setup>>["db"], names: string[]) {
  const rows = await db
    .insert(Author)
    .values(
      names.map((first_name) => ({ author_type: "guest" as const, first_name, last_name: "X" })),
    )
    .returning();
  return rows.map((row) => row.id);
}

describe("save", () => {
  test("stores title and content, orders authors as given, and dates the draft", async () => {
    const { db, articles, events } = await setup();
    const [ana, bor] = await add_authors(db, ["Ana", "Bor"]);
    const draft = await articles.create({ title: "Jama" }, "admin");
    const content = { blocks: [{ type: "paragraph", data: { text: "Pozdravljeni" } }] };

    const saved = await articles.save({
      article_id: draft.id,
      article: { title: "Velika jama", content },
      author_ids: [bor!, ana!],
    });

    expect(saved?.title).toBe("Velika jama");
    expect(saved?.content_json).toEqual(content);
    expect(saved?.published_at).toBeInstanceOf(Date);
    expect(saved?.articles_to_authors.map((rel) => rel.author.first_name)).toEqual(["Bor", "Ana"]);
    expect(events).toEqual(["article.created", "article.saved"]);
  });

  test("keeps stored content and a picked date when a later save omits them", async () => {
    const { articles } = await setup();
    const draft = await articles.create({ title: "Jama" }, "admin");
    const picked = new Date("2026-08-12T00:00:00Z");
    await articles.save({
      article_id: draft.id,
      article: { title: "Jama", published_at: picked },
      author_ids: [],
    });

    const again = await articles.save({
      article_id: draft.id,
      article: { title: "Jama 2" },
      author_ids: [],
    });

    expect(again?.published_at).toEqual(picked);
    expect(again?.content_json?.blocks[0]).toMatchObject({ type: "header" });
  });

  test("rejects an unknown article", async () => {
    const { articles } = await setup();
    await expect(
      articles.save({
        article_id: "00000000-0000-4000-8000-000000000000",
        article: { title: "x" },
        author_ids: [],
      }),
    ).rejects.toThrow(/not found/i);
  });
});

async function add_media(db: Awaited<ReturnType<typeof setup>>["db"], filename: string) {
  const url = `https://gradivo.jknm.org/${filename}`;
  const [media] = await db
    .insert(Media)
    .values({
      id: crypto.randomUUID(),
      filename,
      content_type: "image/jpeg",
      size_bytes: 1,
      original: { url, width: 1, height: 1, size_bytes: 1 },
    })
    .returning();
  return { id: media!.id, url };
}

const image_block = (url: string) => ({ type: "image", data: { file: { url } } });

describe("media reconciliation", () => {
  // Reads `media_to_articles` directly: the links have no other reader yet
  // (the stale-content sweep, step 8, is their consumer).
  const links = async (db: Awaited<ReturnType<typeof setup>>["db"], article_id: string) =>
    (await db.select().from(MediaToArticles).where(eq(MediaToArticles.article_id, article_id)))
      .sort((a, b) => a.order - b.order)
      .map((link) => link.media_id);

  test("each save links exactly the media its content references, in block order", async () => {
    const { db, articles } = await setup();
    const a = await add_media(db, "a.jpg");
    const b = await add_media(db, "b.jpg");
    const draft = await articles.create({ title: "Jama" }, "admin");
    const save = (blocks: object[]) =>
      articles.save({
        article_id: draft.id,
        article: { title: "Jama", content: { blocks: blocks as never } },
        author_ids: [],
      });

    await save([image_block(a.url), image_block(b.url)]);
    expect(await links(db, draft.id)).toEqual([a.id, b.id]);

    await save([image_block(b.url), image_block("https://elsewhere.test/x.jpg")]);
    expect(await links(db, draft.id)).toEqual([b.id]);

    await save([]);
    expect(await links(db, draft.id)).toEqual([]);
  });

  test("a save without content keeps the links of the stored content", async () => {
    const { db, articles } = await setup();
    const a = await add_media(db, "a.jpg");
    const draft = await articles.create({ title: "Jama" }, "admin");
    await articles.save({
      article_id: draft.id,
      article: { title: "Jama", content: { blocks: [image_block(a.url)] } },
      author_ids: [],
    });

    await articles.save({ article_id: draft.id, article: { title: "Jama 2" }, author_ids: [] });

    expect(await links(db, draft.id)).toEqual([a.id]);
  });
});

describe("thumbnail", () => {
  const crop = (image_url: string) => ({
    image_url,
    unit: "%" as const,
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });

  test("a crop of uploaded media is stored; a crop of anything else clears the thumbnail", async () => {
    const { db, articles } = await setup();
    const a = await add_media(db, "a.jpg");
    const draft = await articles.create({ title: "Jama" }, "admin");
    const save = (thumbnail_crop?: ReturnType<typeof crop>) =>
      articles.save({
        article_id: draft.id,
        article: { title: "Jama", thumbnail_crop },
        author_ids: [],
      });

    const with_thumb = await save(crop(a.url));
    expect(with_thumb).toMatchObject({
      thumbnail_media_id: a.id,
      thumbnail_x: 10,
      thumbnail_y: 20,
      thumbnail_width: 30,
      thumbnail_height: 40,
    });

    const external = await save(crop("https://elsewhere.test/x.jpg"));
    expect(external?.thumbnail_media_id).toBeNull();

    await save(crop(a.url));
    const none = await save();
    expect(none?.thumbnail_media_id).toBeNull();
  });
});

describe("publish", () => {
  const publish = (
    articles: Awaited<ReturnType<typeof setup>>["articles"],
    article_id: string,
    title: string,
  ) => articles.publish({ article_id, article: { title }, author_ids: [] });

  test("a first publish takes its public slug from the title", async () => {
    const { articles, events } = await setup();
    const draft = await articles.create({ title: "Jama" }, "admin");

    const { article, slug } = await publish(articles, draft.id, "Čudovita jama");

    expect(slug).toBe("cudovita-jama");
    expect(article.status).toBe("published");
    expect(article.title).toBe("Čudovita jama");
    expect(article.article_slugs).toMatchObject([{ slug: "cudovita-jama", is_primary: true }]);
    expect(article.published_at).toBeInstanceOf(Date);
    expect(events.at(-1)).toBe("article.published");
  });

  test("publishing again keeps the slug it already has", async () => {
    const { articles } = await setup();
    const draft = await articles.create({ title: "Jama" }, "admin");
    await publish(articles, draft.id, "Jama");

    const { slug } = await publish(articles, draft.id, "Povsem drugačen naslov");

    expect(slug).toBe("jama");
  });
});

describe("slug collisions", () => {
  const publish_titled = async (
    articles: Awaited<ReturnType<typeof setup>>["articles"],
    title: string,
  ) => {
    const draft = await articles.create({ title }, "admin");
    return articles.publish({ article_id: draft.id, article: { title }, author_ids: [] });
  };

  test("a second live article with the same title gets a numbered slug", async () => {
    const { articles } = await setup();

    const first = await publish_titled(articles, "Jama");
    const second = await publish_titled(articles, "Jama");
    const third = await publish_titled(articles, "Jama");

    expect([first.slug, second.slug, third.slug]).toEqual(["jama", "jama-2", "jama-3"]);
  });

  test("a deleted article's slug is reusable, since its URL is a dead end", async () => {
    const { articles } = await setup();
    const first = await publish_titled(articles, "Jama");
    await articles.delete({ article_id: first.article.id });

    const second = await publish_titled(articles, "Jama");

    expect(second.slug).toBe("jama");
  });
});

async function status_of(db: Awaited<ReturnType<typeof setup>>["db"], article_id: string) {
  const row = await db.query.Article.findFirst({
    where: eq(Article.id, article_id),
    columns: { status: true },
  });
  return row?.status;
}

function slug_pairs(
  article: { article_slugs: { slug: string; is_primary: boolean }[] } | undefined,
) {
  return (article?.article_slugs ?? [])
    .map((s) => [s.slug, s.is_primary] as const)
    .sort(([a], [b]) => a.localeCompare(b));
}

type Articles = Awaited<ReturnType<typeof setup>>["articles"];
type Db = Awaited<ReturnType<typeof setup>>["db"];

async function publish_new(articles: Articles, title: string) {
  const draft = await articles.create({ title }, "admin");
  return (await articles.publish({ article_id: draft.id, article: { title }, author_ids: [] }))
    .article;
}

describe("archive and delete", () => {
  test("a published article can be archived once", async () => {
    const { articles, events } = await setup();
    const published = await publish_new(articles, "Jama");

    const archived = await articles.archive({ article_id: published.id });

    expect(archived?.status).toBe("archived");
    expect(archived?.archived_at).toBeInstanceOf(Date);
    expect(events.at(-1)).toBe("article.archived");
    await expect(articles.archive({ article_id: published.id })).rejects.toThrow(/archive/);
  });

  test("a draft can be archived too", async () => {
    const { articles } = await setup();
    const draft = await articles.create({ title: "Jama" }, "admin");

    expect((await articles.archive({ article_id: draft.id }))?.status).toBe("archived");
  });

  test("an article can be deleted once, and deleting is terminal", async () => {
    const { articles, events } = await setup();
    const published = await publish_new(articles, "Jama");

    const deleted = await articles.delete({ article_id: published.id });

    expect(deleted.status).toBe("deleted");
    expect(deleted.deleted_at).toBeInstanceOf(Date);
    expect(events.at(-1)).toBe("article.deleted");
    await expect(articles.delete({ article_id: published.id })).rejects.toThrow(/already deleted/);
    await expect(articles.archive({ article_id: published.id })).rejects.toThrow(/archive/);
  });
});

describe("superseding drafts", () => {
  test("revising a published article copies it into a draft and leaves the source live", async () => {
    const { db, articles, events } = await setup();
    const [ana] = await add_authors(db, ["Ana"]);
    const draft = await articles.create({ title: "Jama" }, "admin");
    const content = { blocks: [{ type: "paragraph", data: { text: "Besedilo" } }] };
    const picked = new Date("2020-01-01T00:00:00Z");
    const { article: source } = await articles.publish({
      article_id: draft.id,
      article: { title: "Jama", content, published_at: picked },
      author_ids: [ana!],
    });

    const revision = await articles.create_superseding_draft({ article_id: source.id }, "admin");

    expect(revision).toMatchObject({
      status: "draft",
      supersedes_id: source.id,
      title: "Jama",
      content_json: content,
      published_at: picked,
      created_by: "admin",
    });
    expect(revision.articles_to_authors.map((rel) => rel.author.first_name)).toEqual(["Ana"]);
    expect(await status_of(db, source.id)).toBe("published");
    expect(events).toContain("article.superseding_draft_created");
  });

  test("a second revision of the same article reuses the open draft", async () => {
    const { articles, events } = await setup();
    const source = await publish_new(articles, "Jama");

    const first = await articles.create_superseding_draft({ article_id: source.id }, "admin");
    const again = await articles.create_superseding_draft({ article_id: source.id }, "admin");

    expect(again.id).toBe(first.id);
    expect(events.filter((e) => e === "article.superseding_draft_created")).toHaveLength(1);
  });

  test("unarchiving retires the archived source immediately", async () => {
    const { db, articles, events } = await setup();
    const published = await publish_new(articles, "Jama");
    await articles.archive({ article_id: published.id });

    const revision = await articles.create_superseding_draft({ article_id: published.id }, "admin");

    expect(revision.supersedes_id).toBe(published.id);
    expect(await status_of(db, published.id)).toBe("deleted");
    expect(events.at(-1)).toBe("article.unarchived");
  });

  test("only a published or archived article can be revised", async () => {
    const { articles } = await setup();
    const draft = await articles.create({ title: "Jama" }, "admin");

    await expect(
      articles.create_superseding_draft({ article_id: draft.id }, "admin"),
    ).rejects.toThrow(/superseding draft/);
  });

  test("archiving or deleting a revision acts on the source and takes the revision with it", async () => {
    const { db, articles } = await setup();
    const archive_source = await publish_new(articles, "Jama");
    const archive_revision = await articles.create_superseding_draft(
      { article_id: archive_source.id },
      "admin",
    );
    await articles.archive({ article_id: archive_revision.id });
    expect(await status_of(db, archive_source.id)).toBe("archived");
    expect(await status_of(db, archive_revision.id)).toBe("deleted");

    const delete_source = await publish_new(articles, "Druga jama");
    const delete_revision = await articles.create_superseding_draft(
      { article_id: delete_source.id },
      "admin",
    );
    await articles.delete({ article_id: delete_revision.id });
    expect(await status_of(db, delete_source.id)).toBe("deleted");
    expect(await status_of(db, delete_revision.id)).toBe("deleted");
  });
});

describe("discard_draft", () => {
  test("cancels a revision and leaves a live source untouched", async () => {
    const { db, articles, events } = await setup();
    const source = await publish_new(articles, "Jama");
    const revision = await articles.create_superseding_draft({ article_id: source.id }, "admin");

    await articles.discard_draft({ article_id: revision.id });

    expect(await status_of(db, revision.id)).toBe("deleted");
    expect(await status_of(db, source.id)).toBe("published");
    expect(events.at(-1)).toBe("article.draft_discarded");
  });

  test("discarding an unarchive puts the source back in the archive", async () => {
    const { db, articles } = await setup();
    const source = await publish_new(articles, "Jama");
    await articles.archive({ article_id: source.id });
    const revision = await articles.create_superseding_draft({ article_id: source.id }, "admin");

    await articles.discard_draft({ article_id: revision.id });

    expect(await status_of(db, source.id)).toBe("archived");
    expect(await status_of(db, revision.id)).toBe("deleted");
  });

  test("a standalone draft cannot be discarded", async () => {
    const { articles } = await setup();
    const draft = await articles.create({ title: "Jama" }, "admin");

    await expect(articles.discard_draft({ article_id: draft.id })).rejects.toThrow(/standalone/);
  });
});

describe("publishing a revision", () => {
  async function published_with_legacy_id(articles: Articles, db: Db, title: string) {
    const source = await publish_new(articles, title);
    await db.update(Article).set({ legacy_id: 1234 }).where(eq(Article.id, source.id));
    return source;
  }
  const publish_revision = (articles: Articles, article_id: string, title: string) =>
    articles.publish({ article_id, article: { title }, author_ids: [] });

  test("an unchanged title keeps the source's slug, date and legacy id; the source is retired", async () => {
    const { db, articles } = await setup();
    const source = await published_with_legacy_id(articles, db, "Jama");
    const revision = await articles.create_superseding_draft({ article_id: source.id }, "admin");

    const { article, slug } = await publish_revision(articles, revision.id, "Jama");

    expect(slug).toBe("jama");
    expect(article.published_at).toEqual(source.published_at);
    expect(article.legacy_id).toBe(1234);
    expect(await status_of(db, source.id)).toBe("deleted");
    expect(
      (await db.query.Article.findFirst({ where: eq(Article.id, source.id) }))?.legacy_id,
    ).toBeNull();
  });

  test("a new title mints a new primary slug and the old one keeps resolving to the live article", async () => {
    const { db, articles } = await setup();
    const source = await publish_new(articles, "Jama");
    const revision = await articles.create_superseding_draft({ article_id: source.id }, "admin");

    const { article, slug } = await publish_revision(articles, revision.id, "Velika jama");

    expect(slug).toBe("velika-jama");
    expect(slug_pairs(article)).toEqual([
      ["jama", false],
      ["velika-jama", true],
    ]);
    expect(await status_of(db, source.id)).toBe("deleted");
  });

  test("an unarchived article keeps its slug, date and legacy id when republished", async () => {
    const { db, articles } = await setup();
    const source = await published_with_legacy_id(articles, db, "Jama");
    await articles.archive({ article_id: source.id });
    const revision = await articles.create_superseding_draft({ article_id: source.id }, "admin");

    const { article, slug } = await publish_revision(articles, revision.id, "Jama");

    expect(slug).toBe("jama");
    expect(article.published_at).toEqual(source.published_at);
    expect(article.legacy_id).toBe(1234);
  });

  test("an explicitly picked date wins over the source's", async () => {
    const { articles } = await setup();
    const source = await publish_new(articles, "Jama");
    const revision = await articles.create_superseding_draft({ article_id: source.id }, "admin");
    const picked = new Date("2019-05-05T00:00:00Z");

    const { article } = await articles.publish({
      article_id: revision.id,
      article: { title: "Jama", published_at: picked },
      author_ids: [],
    });

    expect(article.published_at).toEqual(picked);
  });
});

describe("retitling a published article with a plain save", () => {
  const retitle = (articles: Articles, article_id: string, title: string) =>
    articles.save({ article_id, article: { title }, author_ids: [] });

  test("mints a new primary slug and keeps the old one resolvable; reverting promotes it back", async () => {
    const { articles } = await setup();
    const published = await publish_new(articles, "Jama");

    const renamed = await retitle(articles, published.id, "Velika jama");
    expect(slug_pairs(renamed)).toEqual([
      ["jama", false],
      ["velika-jama", true],
    ]);

    const reverted = await retitle(articles, published.id, "Jama");
    expect(slug_pairs(reverted)).toEqual([
      ["jama", true],
      ["velika-jama", false],
    ]);
  });

  test("a draft has no public URL yet, so retitling it mints nothing", async () => {
    const { articles } = await setup();
    const draft = await articles.create({ title: "Jama" }, "admin");

    const saved = await retitle(articles, draft.id, "Velika jama");

    expect(saved?.article_slugs).toEqual([]);
  });

  test("a content page keeps its slug whatever its heading says", async () => {
    const { db, articles } = await setup();
    const page = await publish_new(articles, "Zgodovina");
    await db.update(Article).set({ article_kind: "content" }).where(eq(Article.id, page.id));

    const saved = await retitle(articles, page.id, "Naša zgodovina");

    expect(slug_pairs(saved)).toEqual([["zgodovina", true]]);
  });
});

describe("a failing emit", () => {
  // The change is already committed when `emit` runs, so a cache or search
  // failure must not make the caller lose the result (a draft id, a slug).
  async function with_failing_emit() {
    const { db } = await setup();
    await db.insert(users).values({ id: "other", name: "Other", email: "other@jknm.si" });
    return create_articles({
      db,
      emit: () => {
        throw new Error("cache is down");
      },
    });
  }

  test("does not lose the created draft", async () => {
    const articles = await with_failing_emit();

    const draft = await articles.create({ title: "Jama" }, "other");

    expect(draft.title).toBe("Jama");
  });

  test("does not lose a published result or a spawned revision", async () => {
    const articles = await with_failing_emit();
    const draft = await articles.create({ title: "Jama" }, "other");

    const { slug, article } = await articles.publish({
      article_id: draft.id,
      article: { title: "Jama" },
      author_ids: [],
    });
    const revision = await articles.create_superseding_draft({ article_id: article.id }, "other");

    expect(slug).toBe("jama");
    expect(revision.supersedes_id).toBe(article.id);
  });
});
