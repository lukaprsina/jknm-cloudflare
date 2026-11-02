import { describe, expect, test } from "vite-plus/test";
import { eq } from "drizzle-orm";
import type { DomainEvent } from "../../lib/cache-policy";
import { create_test_db } from "../db/test-helpers";
import { Author, Media, MediaToArticles, users } from "../db/schema";
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
