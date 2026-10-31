import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
type E = { IMG_BUCKET: R2Bucket; IMAGES: ImagesBinding };
// /spike/img?key=img/test.png&w=300&fmt=webp  -> R2 object -> IMAGES binding transform
export async function GET(req: Request) {
  const e = env as unknown as E;
  const u = new URL(req.url);
  const obj = await e.IMG_BUCKET.get(u.searchParams.get("key") ?? "img/test.png");
  if (!obj) return new Response("no object", { status: 404 });
  const fmt = (u.searchParams.get("fmt") ?? "webp") as "webp" | "avif" | "jpeg";
  const t0 = Date.now();
  const out = await e.IMAGES.input(obj.body)
    .transform({ width: Number(u.searchParams.get("w") ?? 300) })
    .output({ format: `image/${fmt}` as "image/webp", quality: 75 });
  const res = out.response();
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("x-transform-ms", String(Date.now() - t0));
  return new Response(res.body, { headers });
}
