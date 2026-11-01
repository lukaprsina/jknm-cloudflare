import { describe, expect, test } from "vite-plus/test";
import { db, runWithDb } from "./index";
import { Author } from "./schema";
import { createTestDb } from "./test-helpers";

describe("ambient db", () => {
  test("throws outside runWithDb", () => {
    expect(() => db.select()).toThrow(/outside runWithDb/);
  });

  test("queries and rolls back through the proxy", async () => {
    const testDb = await createTestDb();
    await runWithDb(testDb, async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(Author).values({ author_type: "guest", first_name: "A", last_name: "B" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await db.select().from(Author)).toHaveLength(0);
    });
  });
});
