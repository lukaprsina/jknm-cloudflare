import { e, guard } from "@/lib/spike-search/worker";
export async function PUT(req: Request) {
  const g = guard(req);
  if (g) return g;
  const key = new URL(req.url).searchParams.get("key") ?? "corpus.json";
  const body = await req.arrayBuffer();
  await e().SEARCH_R2.put(key, body);
  return Response.json({ bytes: body.byteLength });
}
