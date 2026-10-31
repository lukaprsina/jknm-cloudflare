// GET /?key=img/test.png&w=256&fmt=webp  -> R2 -> IMAGES transform, cacheable by Workers Cache.
export default {
  async fetch(req: Request, env: { IMAGES: ImagesBinding; IMG_BUCKET: R2Bucket }) {
    const u = new URL(req.url);
    const obj = await env.IMG_BUCKET.get(u.searchParams.get("key") ?? "img/test.png");
    if (!obj) return new Response("no object", { status: 404 });
    const fmt = u.searchParams.get("fmt") ?? "webp";
    const out = await env.IMAGES.input(obj.body)
      .transform({ width: Number(u.searchParams.get("w") ?? 256) })
      .output({ format: `image/${fmt}` as "image/webp" });
    return out.response({
      headers: {
        "Cache-Control": "public, max-age=3600",
        "x-rendered-at": String(Date.now()),
      },
    });
  },
};
