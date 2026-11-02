import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import type { DomainEvent } from "../../lib/cache-policy";
import { create_articles } from "../article/articles";
import { Author, users } from "../db/schema";
import { create_test_db } from "../db/test-helpers";
import { create_authors } from "./authors";

async function setup() {
  const db = await create_test_db();
  const events: DomainEvent[] = [];
  const emit = (event: DomainEvent) => void events.push(event);
  return { db, events, authors: create_authors({ db, emit }) };
}

describe("guest authors", () => {
  test("a guest can be added and renamed", async () => {
    const { authors, events } = await setup();

    const guest = await authors.add_guest({ first_name: "Ana", last_name: "Novak" });
    const renamed = await authors.rename_guest({
      id: guest.id,
      first_name: "Anja",
      last_name: "Novak",
    });

    expect(guest).toMatchObject({ author_type: "guest", first_name: "Ana", last_name: "Novak" });
    expect(renamed).toMatchObject({ id: guest.id, first_name: "Anja" });
    expect(events).toEqual(["author.inserted", "author.renamed"]);
  });

  test("members are managed by the directory sync, not renamed or deleted here", async () => {
    const { db, authors } = await setup();
    const [member] = await db
      .insert(Author)
      .values({ author_type: "member", first_name: "Miha", last_name: "Kos" })
      .returning();

    await expect(
      authors.rename_guest({ id: member!.id, first_name: "X", last_name: "Y" }),
    ).rejects.toThrow(/guest/i);
    expect(await authors.delete_guests({ ids: [member!.id] })).toEqual([]);

    const [still] = await db.select().from(Author).where(eq(Author.id, member!.id));
    expect(still).toMatchObject({ first_name: "Miha" });
  });

  test("deleting guests removes their bylines from articles", async () => {
    const { db, authors, events } = await setup();
    await db.insert(users).values({ id: "admin", name: "Admin", email: "admin@jknm.si" });
    const articles = create_articles({ db, emit: () => {} });
    const guest = await authors.add_guest({ first_name: "Ana", last_name: "Novak" });
    const draft = await articles.create({ title: "Jama" }, "admin");
    await articles.save({
      article_id: draft.id,
      article: { title: "Jama" },
      author_ids: [guest.id],
    });

    const deleted = await authors.delete_guests({ ids: [guest.id] });

    expect(deleted.map((a) => a.id)).toEqual([guest.id]);
    const after = await articles.save({
      article_id: draft.id,
      article: { title: "Jama" },
      author_ids: [],
    });
    expect(after?.articles_to_authors).toEqual([]);
    expect(events.at(-1)).toBe("author.deleted");
  });
});
