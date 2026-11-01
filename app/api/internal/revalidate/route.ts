import { revalidateTag } from "next/cache";
import { z } from "zod";

export const dynamic = "force-dynamic";

const body = z.object({ tags: z.array(z.string().min(1)).min(1) });

/**
 * Only reachable through the Worker entry's in-process call (see
 * `worker/internal-gate.ts`). Hard expiry, never `"max"`: stale-while-revalidate
 * leaves cached pages stale until their own TTL.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  for (const tag of parsed.data.tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ ok: true, tags: parsed.data.tags });
}
