import { readPlumb } from "@/lib/spike/plumb-cached";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const v = await readPlumb();
  const cf = (req as unknown as { cf?: { colo?: string } }).cf;
  return Response.json({ ...v, colo: cf?.colo });
}
