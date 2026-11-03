import { notFound } from "next/navigation";
import { connection } from "next/server";

/**
 * Answers 404 for a page the public may not see. The render is made dynamic
 * first, because a dynamic render is never stored, so junk URLs cannot
 * accumulate cache entries.
 */
export async function not_found_uncached(): Promise<never> {
  await connection();
  notFound();
}
