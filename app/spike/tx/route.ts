import { eq } from "drizzle-orm";
import { db } from "@/lib/spike/db";
import { withRequestDb, type Mode } from "@/lib/spike/pg-db";
import { probe } from "@/lib/spike/schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const read = async (id: number) =>
  (await db.select().from(probe).where(eq(probe.id, id)))[0]?.counter;

export async function GET(req: Request) {
  const mode = (new URL(req.url).searchParams.get("mode") ?? "pool") as Mode;
  try {
    return Response.json(
      await withRequestDb(async () => {
        const out: Record<string, unknown> = { mode };
        const [row] = await db
          .insert(probe)
          .values({ label: `tx-${mode}`, counter: 0 })
          .returning();
        const id = row!.id;

        // 1. commit
        await db.transaction(async (tx) => {
          const [r] = await tx.select().from(probe).where(eq(probe.id, id)).for("update");
          await tx
            .update(probe)
            .set({ counter: r!.counter + 1 })
            .where(eq(probe.id, id));
        });
        out.afterCommit = await read(id); // expect 1

        // 2. rollback on throw
        try {
          await db.transaction(async (tx) => {
            await tx.update(probe).set({ counter: 99 }).where(eq(probe.id, id));
            out.insideTxSeesOwnWrite = (
              await tx.select().from(probe).where(eq(probe.id, id))
            )[0]?.counter;
            throw new Error("boom");
          });
        } catch (e) {
          out.thrown = (e as Error).message;
        }
        out.afterRollback = await read(id); // expect 1

        // 3. savepoint: inner rollback, outer commit
        await db.transaction(async (tx) => {
          await tx.update(probe).set({ counter: 2 }).where(eq(probe.id, id));
          await tx
            .transaction(async (tx2) => {
              await tx2.update(probe).set({ counter: 50 }).where(eq(probe.id, id));
              throw new Error("inner");
            })
            .catch(() => {});
        });
        out.afterSavepoint = await read(id); // expect 2

        // 4. FOR UPDATE contention: two concurrent txs, each reads under lock, sleeps, writes +1.
        if (mode === "pool") {
          const t0 = Date.now();
          const worker = (name: string) =>
            db.transaction(async (tx) => {
              const [r] = await tx.select().from(probe).where(eq(probe.id, id)).for("update");
              const gotLockAt = Date.now() - t0;
              await sleep(400);
              await tx
                .update(probe)
                .set({ counter: r!.counter + 1 })
                .where(eq(probe.id, id));
              return { name, sawCounter: r!.counter, gotLockAt };
            });
          out.contention = await Promise.all([worker("A"), worker("B")]);
          out.afterContention = await read(id); // expect 4 (lost update would give 3)
          out.contentionMs = Date.now() - t0;
        }
        out.id = id;
        return out;
      }, mode),
    );
  } catch (e) {
    return Response.json({ error: String((e as Error).message).slice(0, 300) }, { status: 500 });
  }
}
