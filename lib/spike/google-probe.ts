// Shared by the Vinext route (/spike/google) and the standalone scratch Worker. Read-only:
// token exchange + users.list. Prints counts, field names and one masked sample, never key
// material or full emails.
import { createHash } from "node:crypto";
import {
  getAccessToken,
  listMembers,
  parseServiceAccount,
  type GoogleMember,
  type Timings,
} from "./google-directory";

const mask = (e: string | null) => (e ? e.replace(/^(.{2}).*@/, "$1***@") : e);

export async function runGoogleProbe(
  creds: string,
  customer: string,
  params: { maxResults?: number; breakKey?: "literal-n" | "none" } = {},
) {
  const out: Record<string, unknown> = {};
  const t0 = performance.now();
  try {
    let raw = creds;
    if (params.breakKey === "literal-n") {
      // simulate a secret stored as JSON with escaped newlines inside private_key
      const j = JSON.parse(atob(creds));
      j.private_key = j.private_key.replace(/\n/g, "\\n");
      raw = btoa(JSON.stringify(j));
    }
    const sa = parseServiceAccount(raw);
    const timings = {} as Timings;
    const tTok = performance.now();
    const { token, expiresIn } = await getAccessToken(sa, { timings });
    out.token = {
      expiresIn,
      wallMs: Math.round(performance.now() - tTok),
      ...Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, +v.toFixed(1)])),
    };
    const pages: number[] = [];
    const tList = performance.now();
    const members: GoogleMember[] = await listMembers(token, {
      customer,
      maxResults: params.maxResults,
      onPage: (n) => pages.push(n),
    });
    out.list = {
      count: members.length,
      pages: pages.length,
      perPage: pages,
      wallMs: Math.round(performance.now() - tList),
    };
    const digest = createHash("sha256")
      .update(
        JSON.stringify(
          members.map((m) => [m.google_id, m.first_name, m.last_name, m.email, m.image]).sort(),
        ),
      )
      .digest("hex")
      .slice(0, 12);
    out.digest = digest;
    const s = members[0]!;
    out.fields = Object.keys(s);
    out.sample = {
      id: s.google_id.slice(0, 4) + "…",
      email: mask(s.email),
      first: s.first_name[0] + "…",
    };
  } catch (e) {
    const err = e as Error & { step?: string; status?: number };
    out.error = {
      name: err.name,
      step: err.step,
      status: err.status,
      message: String(err.message).slice(0, 200),
    };
  }
  out.totalWallMs = Math.round(performance.now() - t0);
  return out;
}
