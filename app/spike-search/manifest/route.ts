import { e } from "@/lib/spike-search/worker";
export const dynamic = "force-dynamic";
// Public (no token): serves only the small manifest. The format is a query param.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("format");
  const f = q === "seqproto" || q === "chunked" ? q : "json";
  const o = await e().SEARCH_R2.get(`search/manifest-${f}.json`);
  if (!o) return new Response("none", { status: 404 });
  return new Response(o.body, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
}
