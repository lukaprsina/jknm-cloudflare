import { eq } from "drizzle-orm";
import { UnsecuredJWT } from "jose";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { db, run_with_db, type Db } from "../db";
import { sessions, users } from "../db/schema";
import { create_test_db } from "../db/test-helpers";
import { create_auth } from "./create-auth";
import { google_user_info } from "./google-user";
import { to_app_session } from "./session-shape";

const SECRET = "test-secret-test-secret-0123456789abcdef";
const HOST = "localhost:3000";

const build = (extra: Partial<Parameters<typeof create_auth>[0]> = {}) =>
  create_auth({
    db,
    secret: SECRET,
    google: { client_id: "id", client_secret: "secret" },
    allowed_hosts: [HOST, "jknm.org"],
    fallback_origin: "https://jknm.org",
    secure_cookies: false,
    ...extra,
  });

/** Cookie value format: encodeURIComponent(`${token}.${base64(HMAC-SHA256(token, secret))}`). */
async function signed(token: string, secret = SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)),
  );
  return encodeURIComponent(`${token}.${btoa(String.fromCharCode(...sig))}`);
}

const cookie_headers = async (token: string, secret?: string) =>
  new Headers({ cookie: `better-auth.session_token=${await signed(token, secret)}`, host: HOST });

async function setup() {
  const test_db = await create_test_db();
  await test_db
    .insert(users)
    .values({ id: "u1", name: "Urednik", email: "urednik@jknm.si", emailVerified: true });
  await test_db.insert(sessions).values([
    { id: "s1", userId: "u1", token: "tok-valid", expiresAt: new Date(Date.now() + 3_600_000) },
    { id: "s2", userId: "u1", token: "tok-expired", expiresAt: new Date(Date.now() - 3_600_000) },
  ]);
  return test_db;
}

describe("session", () => {
  let test_db: Db;
  beforeEach(async () => {
    test_db = await setup();
  });
  const in_db = <T>(fn: () => T, target: Db = test_db) => run_with_db(target, fn);

  test("a signed session cookie resolves to the app session", async () => {
    const auth = build();
    const result = await in_db(async () =>
      auth.api.getSession({ headers: await cookie_headers("tok-valid") }),
    );
    const session = to_app_session(result);
    expect(session?.user).toEqual({
      id: "u1",
      name: "Urednik",
      email: "urednik@jknm.si",
      image: null,
    });
    expect(session?.expires).toMatch(/Z$/);
  });

  test("no cookie is no session", async () => {
    const auth = build();
    const result = await in_db(() => auth.api.getSession({ headers: new Headers({ host: HOST }) }));
    expect(result).toBeNull();
  });

  test("rejects a wrong secret, a tampered signature, an expired and an unknown token", async () => {
    const auth = build();
    const get = (headers: Headers) => in_db(() => auth.api.getSession({ headers }));
    expect(
      await get(await cookie_headers("tok-valid", "another-secret-0123456789abcdefghij")),
    ).toBeNull();
    expect(
      await get(new Headers({ cookie: "better-auth.session_token=tok-valid.AAAA", host: HOST })),
    ).toBeNull();
    expect(await get(await cookie_headers("tok-expired"))).toBeNull();
    expect(await get(await cookie_headers("tok-nope"))).toBeNull();
  });

  test("one instance resolves the db of the current scope, also under concurrency", async () => {
    const auth = build(); // built once, outside any scope, like the isolate singleton
    const empty = await create_test_db();
    const headers = await cookie_headers("tok-valid");
    const found = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        in_db(() => auth.api.getSession({ headers }), i % 2 ? test_db : empty).then(Boolean),
      ),
    );
    expect(found).toEqual(Array.from({ length: 10 }, (_, i) => i % 2 === 1));
  });

  test("sign-out deletes the session row", async () => {
    const auth = build();
    await in_db(async () => {
      const response = await auth.handler(
        new Request(`http://${HOST}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            ...Object.fromEntries(await cookie_headers("tok-valid")),
            origin: `http://${HOST}`,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(response.status).toBe(200);
      const rows = await test_db.select().from(sessions).where(eq(sessions.token, "tok-valid"));
      expect(rows).toHaveLength(0);
    });
  });
});

describe("starting a Google sign-in", () => {
  const start = (auth: ReturnType<typeof build>, host: string) =>
    auth.handler(
      new Request(`http://${host}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { origin: `http://${host}`, "content-type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      }),
    );

  test("builds the redirect URI from an allowed request host", async () => {
    const test_db = await create_test_db();
    const response = await run_with_db(test_db, () => start(build(), HOST));
    const { url } = (await response.json()) as { url: string };
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      `http://${HOST}/api/auth/callback/google`,
    );
  });

  test("a host that is not allowed never reaches the redirect URI", async () => {
    const test_db = await create_test_db();
    const response = await run_with_db(test_db, () => start(build(), "evil.example.com"));
    const { url } = (await response.json()) as { url: string };
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      "https://jknm.org/api/auth/callback/google",
    );
  });

  test("works outside a request, where there is no host", async () => {
    const test_db = await create_test_db();
    const session = await run_with_db(test_db, () =>
      build().api.getSession({ headers: new Headers() }),
    );
    expect(session).toBeNull();
  });

  test("cookies are Secure-prefixed only when asked", async () => {
    const test_db = await create_test_db();
    const names = async (secure_cookies: boolean) => {
      const response = await run_with_db(test_db, () => start(build({ secure_cookies }), HOST));
      return response.headers.getSetCookie().map((c) => c.split("=")[0]);
    };
    expect(await names(true)).toContain("__Secure-better-auth.state");
    expect(await names(false)).toContain("better-auth.state");
  });
});

describe("google_user_info", () => {
  const id_token = (claims: Record<string, unknown>) =>
    new UnsecuredJWT(claims).setIssuedAt().encode();

  test("maps a verified club account to a user", async () => {
    const info = await google_user_info({
      idToken: id_token({
        email: "urednik@jknm.si",
        email_verified: true,
        name: "Urednik",
        picture: "https://lh3.googleusercontent.com/a/x",
      }),
    });
    expect(info?.user).toEqual({
      name: "Urednik",
      email: "urednik@jknm.si",
      image: "https://lh3.googleusercontent.com/a/x",
      emailVerified: true,
    });
  });

  test("turns away another domain, an unverified address and a missing ID token", async () => {
    const other = { email: "x@gmail.com", email_verified: true, name: "X" };
    expect(await google_user_info({ idToken: id_token(other) })).toBeNull();
    const unverified = { email: "x@jknm.si", email_verified: false, name: "X" };
    expect(await google_user_info({ idToken: id_token(unverified) })).toBeNull();
    expect(await google_user_info({})).toBeNull();
  });
});
