import { e, guard } from "@/lib/spike-search/worker";
export async function PUT(req: Request) {
  const g = guard(req);
  if (g) return g;
  const body = await req.arrayBuffer();
  await e().SEARCH_R2.put("corpus.json", body);
  return Response.json({ bytes: body.byteLength });
}
