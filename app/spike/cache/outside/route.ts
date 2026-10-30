import { revalidateTag, updateTag } from "next/cache";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const which = new URL(req.url).searchParams.get("fn");
  try {
    if (which === "updateTag") updateTag("spike");
    else if (which === "revalidateTag") (revalidateTag as (t: string) => void)("spike");
    else if (which === "revalidateTagMax") revalidateTag("spike", "max");
    return Response.json({ ok: true, which });
  } catch (e) {
    return Response.json({ ok: false, which, error: (e as Error).message.slice(0, 120) });
  }
}
