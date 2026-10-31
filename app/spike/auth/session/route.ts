import { authFor } from "@/lib/spike/auth/instances";
import { to_app_session } from "@/lib/spike/auth/session-shape";

export const dynamic = "force-dynamic";

// GET /spike/auth/session?mode=singleton|request  (cookie in the request)
export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get("mode");
  const t0 = performance.now();
  try {
    const auth = authFor(mode);
    const t1 = performance.now();
    const r = await auth.api.getSession({ headers: req.headers });
    const t2 = performance.now();
    return Response.json({
      mode: mode ?? "singleton",
      session: to_app_session(r),
      ms: { construct: +(t1 - t0).toFixed(2), getSession: +(t2 - t1).toFixed(2) },
    });
  } catch (e) {
    return Response.json({ error: String((e as Error).message).slice(0, 300) }, { status: 500 });
  }
}
