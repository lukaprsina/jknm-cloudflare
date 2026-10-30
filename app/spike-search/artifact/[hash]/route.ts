import { e } from "@/lib/spike-search/worker";
export const dynamic = "force-dynamic";
// The artifact is public by design (it is what the browser downloads); the key is content-hashed.
export async function GET(req: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!/^(json|seqproto|chunked)-[0-9a-f]{16}$/.test(hash))
    return new Response("bad", { status: 400 });
  const o = await e().SEARCH_R2.get(`search/${hash}`);
  if (!o) return new Response("none", { status: 404 });
  const h = new Headers();
  o.writeHttpMetadata(h);
  h.set("etag", o.httpEtag);
  if (new URL(req.url).searchParams.has("meta"))
    return Response.json({ http: o.httpMetadata, hdr: [...h] });
  if (new URL(req.url).searchParams.has("identity")) {
    // Local-dev workaround (the dev bridge drops Content-Encoding): serve decoded bytes.
    const z = await import("node:zlib");
    const raw = z.brotliDecompressSync(new Uint8Array(await o.arrayBuffer()));
    h.delete("content-encoding");
    return new Response(raw, { headers: h });
  }
  return new Response(o.body, { headers: h, encodeBody: "manual" } as ResponseInit);
}
