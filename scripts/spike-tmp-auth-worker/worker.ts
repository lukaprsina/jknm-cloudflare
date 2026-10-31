import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { waitUntil } from "cloudflare:workers";
import { runGoogleProbe } from "../../lib/spike/google-probe";

interface Env {
  SPIKE_TOKEN: string;
  JKNM_SERVICE_ACCOUNT_CREDENTIALS: string;
  JKNM_WORKSPACE_ID: string;
}

function auth(secure: boolean | undefined) {
  return betterAuth({
    baseURL: { allowedHosts: ["*.workers.dev", "localhost:*"] },
    secret: "spike-secret-spike-secret-spike-secret-0123456789",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    advanced: { useSecureCookies: secure, backgroundTasks: { handler: waitUntil } },
    socialProviders: { google: { clientId: "x", clientSecret: "y" } },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.SPIKE_TOKEN || request.headers.get("x-spike-token") !== env.SPIKE_TOKEN) {
      return new Response("forbidden", { status: 403 });
    }
    const u = new URL(request.url);
    if (u.pathname === "/cookie") {
      // Set-Cookie attributes of better-auth on a deployed https Worker (values masked)
      const p = u.searchParams.get("secure");
      const a = auth(p === "1" ? true : p === "0" ? false : undefined);
      const res = await a.handler(
        new Request(`${u.origin}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: u.origin },
          body: JSON.stringify({ provider: "google", callbackURL: "/" }),
        }),
      );
      let waited = false;
      waitUntil(Promise.resolve().then(() => (waited = true)));
      return Response.json({
        status: res.status,
        runtimeNodeEnv: process.env["NODE_ENV"] ?? null,
        processEnvKeys: Object.keys(process.env),
        cookies: res.headers.getSetCookie().map((c) => c.replace(/=([^;]{8,})/, "=<v>")),
        waitUntilImportOk: typeof waitUntil === "function",
        waited,
      });
    }
    const maxResults = u.searchParams.get("maxResults");
    const result = await runGoogleProbe(
      env.JKNM_SERVICE_ACCOUNT_CREDENTIALS,
      env.JKNM_WORKSPACE_ID,
      {
        maxResults: maxResults ? Number(maxResults) : undefined,
        breakKey: (u.searchParams.get("breakKey") as "literal-n" | null) ?? undefined,
      },
    );
    return Response.json(result);
  },
};
