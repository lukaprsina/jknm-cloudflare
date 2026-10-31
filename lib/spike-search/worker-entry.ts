// SPIKE: custom entry so the pre-compressed artifact bypasses vinext's Response rewriting and is
// served with encodeBody: "manual" (otherwise workerd re-encodes the already-brotli body).
import handler from "vinext/server/fetch-handler";

export * from "vinext/server/fetch-handler";

type E = { SEARCH_R2: R2Bucket };

export default {
  async fetch(request: Request, env: E, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.startsWith("/spike-search/a/")) {
      const key = url.pathname.slice("/spike-search/a/".length);
      if (!/^(json|seqproto|chunked)-[0-9a-f]{16}[a-z0-9]*$/.test(key))
        return new Response("bad", { status: 400 });
      const o = await env.SEARCH_R2.get(`search/${key}`);
      if (!o) return new Response("none", { status: 404 });
      const h = new Headers();
      o.writeHttpMetadata(h);
      h.set("etag", o.httpEtag);
      return new Response(o.body, { headers: h, encodeBody: "manual" } as ResponseInit);
    }
    return handler.fetch(request, env as never, ctx);
  },
};
