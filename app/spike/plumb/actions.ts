"use server";
import { revalidateTag, updateTag } from "next/cache";
import { bumpCounter } from "@/lib/spike/plumb-cached";

export async function bumpNoInvalidate() {
  await bumpCounter();
}
export async function bumpUpdateTag() {
  await bumpCounter();
  updateTag("plumb");
}
export async function bumpRevalidateTag() {
  await bumpCounter();
  revalidateTag("plumb", { expire: 0 });
}
export async function bumpRevalidateTagMax() {
  await bumpCounter();
  revalidateTag("plumb", "max");
}
