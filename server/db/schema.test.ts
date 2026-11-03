import { describe, expect, test } from "vite-plus/test";
import { Article } from "./schema";
import { create_test_db } from "./test-helpers";

describe("Article", () => {
  test("a published row must have a published_at", async () => {
    const db = await create_test_db();
    await expect(db.insert(Article).values({ title: "A", status: "published" })).rejects.toThrow();
    await db.insert(Article).values({ title: "B", status: "draft" });
    await db.insert(Article).values({ title: "C", status: "published", published_at: new Date() });
  });
});
