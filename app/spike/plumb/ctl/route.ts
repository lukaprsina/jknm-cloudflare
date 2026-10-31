import { env } from "cloudflare:workers";
import { bumpCounter } from "@/lib/spike/plumb-cached";

export const dynamic = "force-dynamic";
type E = { IMG_BUCKET: R2Bucket; QUEUE: Queue };
// ?op=bump | send&mode=direct|handler&id=x | cronmode&mode=... | log | clearlog
export async function GET(req: Request) {
  const e = env as unknown as E;
  const u = new URL(req.url);
  const op = u.searchParams.get("op");
  if (op === "bump") return Response.json({ counter: await bumpCounter() });
  if (op === "send") {
    await e.QUEUE.send({
      mode: u.searchParams.get("mode") ?? "none",
      id: u.searchParams.get("id") ?? "x",
    });
    return Response.json({ sent: true });
  }
  if (op === "cronmode") {
    await e.IMG_BUCKET.put("state/cronmode", u.searchParams.get("mode") ?? "none");
    return Response.json({ ok: true });
  }
  if (op === "clearlog") {
    const l = await e.IMG_BUCKET.list({ prefix: "log/" });
    await Promise.all(l.objects.map((o) => e.IMG_BUCKET.delete(o.key)));
    return Response.json({ cleared: l.objects.length });
  }
  const l = await e.IMG_BUCKET.list({ prefix: "log/" });
  const items = await Promise.all(
    l.objects
      .slice(-30)
      .map(async (o) => JSON.parse(await (await e.IMG_BUCKET.get(o.key))!.text())),
  );
  return Response.json(items);
}
