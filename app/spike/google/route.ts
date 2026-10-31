import { getEnvString } from "@/lib/spike/cf-env";
import { runGoogleProbe } from "@/lib/spike/google-probe";

export const dynamic = "force-dynamic";

// GET /spike/google?maxResults=200&breakKey=literal-n   (guarded by x-spike-token in worker-entry)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const creds = getEnvString("JKNM_SERVICE_ACCOUNT_CREDENTIALS");
  const customer = getEnvString("JKNM_WORKSPACE_ID");
  if (!creds || !customer)
    return Response.json({ error: "credentials binding missing" }, { status: 500 });
  const maxResults = u.searchParams.get("maxResults");
  return Response.json(
    await runGoogleProbe(creds, customer, {
      maxResults: maxResults ? Number(maxResults) : undefined,
      breakKey: (u.searchParams.get("breakKey") as "literal-n" | null) ?? undefined,
    }),
  );
}
