import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { db, runWithDb, type Db } from "./db";
import * as schema from "./schema";
import { probe } from "./schema";

async function createTestDb() {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  const { apply } = await pushSchema(schema, pg as unknown as Parameters<typeof pushSchema>[1]);
  await apply();
  return pg;
}

describe("request-scoped db proxy over pglite", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  test("PgliteDatabase is assignable to Db without a cast", () => {
    const asDb: Db = testDb; // compile-time check (vp check)
    expect(asDb).toBeDefined();
  });

  test("throws outside runWithDb", () => {
    expect(() => db.select()).toThrow(/no request-scoped db/);
  });

  test("insert/select/transaction/rollback via the proxy", async () => {
    await runWithDb(testDb, async () => {
      const [row] = await db.insert(probe).values({ label: "t", counter: 0 }).returning();
      await db.transaction(async (tx) => {
        const [r] = await tx.select().from(probe).where(eq(probe.id, row!.id)).for("update");
        await tx
          .update(probe)
          .set({ counter: r!.counter + 1 })
          .where(eq(probe.id, row!.id));
      });
      await expect(
        db.transaction(async (tx) => {
          await tx.update(probe).set({ counter: 99 }).where(eq(probe.id, row!.id));
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      const [after] = await db.select().from(probe).where(eq(probe.id, row!.id));
      expect(after!.counter).toBe(1);
      expect(after!.created_at).toBeInstanceOf(Date);
    });
  });
});
