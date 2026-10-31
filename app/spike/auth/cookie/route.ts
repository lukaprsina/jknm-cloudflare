import { buildAuthForCookieProbe } from "@/lib/spike/auth/instances";

export const dynamic = "force-dynamic";

// GET /spike/auth/cookie?secure=1|0|default  -> Set-Cookie attributes (values masked) of a
// sign-in/social response, plus what the runtime thinks NODE_ENV is.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const p = u.searchParams.get("secure");
  const auth = buildAuthForCookieProbe(p === "1" ? true : p === "0" ? false : undefined);
  const res = await auth.handler(
    new Request(`${u.origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: u.origin },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    }),
  );
  const cookies = res.headers.getSetCookie().map((c) => c.replace(/=([^;]{8,})/, "=<v>"));
  return Response.json({
    status: res.status,
    nodeEnv: process.env.NODE_ENV ?? null,
    cookies,
  });
}
