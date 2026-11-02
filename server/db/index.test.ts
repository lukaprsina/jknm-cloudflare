import { describe, expect, test } from "vite-plus/test";
import { db, run_with_db } from "./index";
import { Author } from "./schema";
import { create_test_db } from "./test-helpers";

describe("ambient db", () => {
  test("throws outside run_with_db", () => {
    expect(() => db.select()).toThrow(/outside run_with_db/);
  });

  test("queries and rolls back through the proxy", async () => {
    const test_db = await create_test_db();
    await run_with_db(test_db, async () => {
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
