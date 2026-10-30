import { withRequestDb } from "@/lib/spike/pg-db";
import { readCachedProbe } from "@/lib/spike/cached";

export const dynamic = "force-dynamic";
export async function GET() {
  return withRequestDb(async () => {
    const v = await readCachedProbe();
    return Response.json({
      counter: v.counter,
      createdAtType: typeof v.created_at,
      createdAtIsDate: v.created_at instanceof Date,
      readAt: v.readAt,
    });
  }).then((r) => r);
}
