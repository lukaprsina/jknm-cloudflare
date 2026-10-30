"use server";
import { eq, sql } from "drizzle-orm";
import { revalidateTag, updateTag } from "next/cache";
import { db } from "@/lib/spike/db";
import { withRequestDb } from "@/lib/spike/pg-db";
import { probe } from "@/lib/spike/schema";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const bump = () =>
  withRequestDb(() =>
    db
      .update(probe)
      .set({ counter: sql`${probe.counter} + 1` })
      .where(eq(probe.label, "cache")),
  );

export async function resultAction(n: number): Promise<Result<{ doubled: number }>> {
  if (n < 0) return { ok: false, error: "Negativno število ni dovoljeno" };
  return { ok: true, data: { doubled: n * 2 } };
}

export async function throwingAction(): Promise<Result<never>> {
  throw new Error("SECRET-INTERNAL-MESSAGE Napaka v bazi");
}

export async function bumpUpdateTag() {
  await bump();
  updateTag("spike");
}
export async function bumpRevalidateTag() {
  await bump();
  // one-arg form is a TS error under vinext/next types (TS2554); cast to exercise runtime
  (revalidateTag as (t: string) => void)("spike");
}
export async function bumpRevalidateTagMax() {
  await bump();
  revalidateTag("spike", "max"); // stale-while-revalidate
}
export async function bumpNoInvalidate() {
  await bump();
}
