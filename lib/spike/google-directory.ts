// Google Admin SDK Directory `users.list` with fetch + jose (replaces googleapis +
// google-auth-library in .references/jknm/src/server/author/sync_members.ts).
//
// Flow (OAuth 2.0 service-account, "JWT bearer" grant, RFC 7523):
//   1. sign a JWT {iss, scope, aud: token_uri, iat, exp[, sub]} with RS256 using the SA private key
//   2. POST grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt> to token_uri
//   3. GET https://admin.googleapis.com/admin/directory/v1/users?customer=...&maxResults=200
//      with `Authorization: Bearer <access_token>`, following nextPageToken.
// The old code passed NO `subject` (no impersonation); `sub` is therefore optional here.
// No `cloudflare:workers`, no Node-only imports: runs in Node, workerd, tests.
import { importPKCS8, SignJWT } from "jose";

export const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";
const USERS_URL = "https://admin.googleapis.com/admin/directory/v1/users";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GoogleMember {
  google_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  image: string | null;
}

export class GoogleApiError extends Error {
  readonly step: "token" | "users.list";
  readonly status: number;
  readonly reason: string;
  constructor(step: "token" | "users.list", status: number, reason: string) {
    super(`${step} failed: HTTP ${status} ${reason}`);
    this.step = step;
    this.status = status;
    this.reason = reason;
  }
}

/**
 * JKNM_SERVICE_ACCOUNT_CREDENTIALS is base64(JSON) in the old repo. Also tolerates raw JSON.
 * `private_key` may arrive with literal `\n` two-character sequences when the JSON was
 * double-escaped (typical when pasted into a dashboard / .env); PKCS8 import needs real newlines.
 */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : atob(raw.trim());
  const json = JSON.parse(text) as Partial<ServiceAccount>;
  if (!json.client_email || !json.private_key) throw new Error("service account JSON incomplete");
  return {
    client_email: json.client_email,
    private_key: json.private_key.replace(/\\n/g, "\n"),
    token_uri: json.token_uri,
  };
}

export interface Timings {
  importKeyMs: number;
  signMs: number;
  tokenExchangeMs: number;
}

export async function getAccessToken(
  sa: ServiceAccount,
  opts: { scope?: string; sub?: string; timings?: Timings; fetch?: typeof fetch } = {},
): Promise<{ token: string; expiresIn: number }> {
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const f = opts.fetch ?? fetch;
  let t = performance.now();
  const key = await importPKCS8(sa.private_key, "RS256");
  const t1 = performance.now();
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: opts.scope ?? DIRECTORY_SCOPE,
    ...(opts.sub ? { sub: opts.sub } : {}),
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const t2 = performance.now();
  const res = await f(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (opts.timings) {
    opts.timings.importKeyMs = t1 - t;
    opts.timings.signMs = t2 - t1;
    opts.timings.tokenExchangeMs = performance.now() - t2;
  }
  t = 0;
  if (!res.ok || !body.access_token) {
    throw new GoogleApiError(
      "token",
      res.status,
      `${body.error ?? "?"}: ${body.error_description ?? ""}`,
    );
  }
  return { token: body.access_token, expiresIn: body.expires_in ?? 3600 };
}

interface DirectoryUser {
  id?: string;
  primaryEmail?: string;
  suspended?: boolean;
  thumbnailPhotoUrl?: string;
  name?: { givenName?: string; familyName?: string; fullName?: string };
}

/** Mirrors fetch_google_members() of the old repo (same trimming, same hard errors). */
export async function listMembers(
  token: string,
  opts: {
    customer: string;
    maxResults?: number;
    fetch?: typeof fetch;
    onPage?: (n: number) => void;
  },
): Promise<GoogleMember[]> {
  const f = opts.fetch ?? fetch;
  const members: GoogleMember[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const url = new URL(USERS_URL);
    url.searchParams.set("customer", opts.customer);
    url.searchParams.set("maxResults", String(opts.maxResults ?? 200));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await f(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; status?: string };
      };
      throw new GoogleApiError(
        "users.list",
        res.status,
        `${e.error?.status ?? ""} ${e.error?.message ?? ""}`.trim(),
      );
    }
    const data = (await res.json()) as { users?: DirectoryUser[]; nextPageToken?: string };
    pages++;
    opts.onPage?.(data.users?.length ?? 0);
    if (!data.users) throw new Error("No Google Admin users found");
    for (const user of data.users) {
      const first_name = user.name?.givenName?.trim();
      const last_name = user.name?.familyName?.trim();
      const full_name = user.name?.fullName ?? user.id;
      if (!first_name || !last_name)
        throw new Error(`No given/family name for Google user ${full_name}`);
      const google_id = user.id;
      if (!google_id) throw new Error(`No Google ID for user ${full_name}`);
      if (seen.has(google_id)) throw new Error(`Duplicate Google ID for user ${full_name}`);
      seen.add(google_id);
      members.push({
        google_id,
        first_name,
        last_name,
        email: user.primaryEmail ?? null,
        image: user.thumbnailPhotoUrl ?? null,
      });
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
  void pages;
  return members;
}

export async function fetchGoogleMembers(
  credentialsB64: string,
  customer: string,
  opts: { sub?: string; maxResults?: number; timings?: Timings; onPage?: (n: number) => void } = {},
): Promise<GoogleMember[]> {
  const sa = parseServiceAccount(credentialsB64);
  const { token } = await getAccessToken(sa, opts);
  return listMembers(token, { customer, maxResults: opts.maxResults, onPage: opts.onPage });
}
