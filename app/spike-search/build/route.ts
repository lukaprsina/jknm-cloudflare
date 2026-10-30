import { guard, runBuild } from "@/lib/spike-search/worker";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const g = guard(req);
  if (g) return g;
  try {
    return Response.json(await runBuild(new URL(req.url)));
  } catch (err) {
    return Response.json({ error: String((err as Error)?.stack ?? err) }, { status: 500 });
  }
}
