import { revalidateTag, updateTag } from "next/cache";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const which = sp.get("fn");
  const tag = sp.get("tag") ?? "spike";
  try {
    if (which === "updateTag") updateTag(tag);
    else if (which === "revalidateTag") (revalidateTag as (t: string) => void)(tag);
    else if (which === "revalidateTagMax") revalidateTag(tag, "max");
    return Response.json({ ok: true, which, tag });
  } catch (e) {
    return Response.json({ ok: false, which, error: (e as Error).message.slice(0, 120) });
  }
}
