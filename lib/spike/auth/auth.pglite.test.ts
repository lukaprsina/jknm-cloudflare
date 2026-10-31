import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { db, getDb, runWithDb, type Db } from "../db";
import * as schema from "../schema";
import { createAuth, to_app_session, type Auth } from "./auth";
import { createAuthTables } from "./tables";

const SECRET = "spike-test-secret-spike-test-secret-0123456789";
const HOST = "localhost:5173";

const tables = createAuthTables(); // default (public) schema
const fullSchema = { ...schema, ...tables };

async function createTestDb() {
  const client = new PGlite();
  const pg = drizzle(client, { schema: fullSchema });
  const { apply } = await pushSchema(fullSchema, pg as unknown as Parameters<typeof pushSchema>[1]);
  await apply();
  return pg;
}

/** Cookie value format: encodeURIComponent(`${token}.${base64(HMAC-SHA256(token, secret))}`) */
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

function build(dbArg: Parameters<typeof createAuth>[0]["db"], extra: object = {}) {
  return createAuth({
    db: dbArg,
    tables,
    secret: SECRET,
    googleClientId: "id",
    googleClientSecret: "secret",
    allowedHosts: [HOST, "jknm.si"],
    ...extra,
  });
}

describe("better-auth over the request-scoped db", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let seeded: { token: string };
  beforeEach(async () => {
    testDb = await createTestDb();
    await testDb
      .insert(tables.user)
      .values({ id: "u1", name: "Test Editor", email: "editor@jknm.si", emailVerified: true });
    await testDb.insert(tables.session).values({
      id: "s1",
      userId: "u1",
      token: "tok-valid",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await testDb.insert(tables.session).values({
      id: "s2",
      userId: "u1",
      token: "tok-expired",
      expiresAt: new Date(Date.now() - 3600_000),
    });
    seeded = { token: "tok-valid" };
  });

  const headersFor = async (token: string, secret?: string) =>
    new Headers({ cookie: `better-auth.session_token=${await signed(token, secret)}`, host: HOST });

  test("singleton over the ALS proxy: getSession with signed cookie", async () => {
    const auth: Auth = build(db as never); // constructed OUTSIDE any runWithDb scope
    const res = await runWithDb(testDb as unknown as Db, () =>
      auth.api.getSession({ headers: new Headers({ host: HOST }) }),
    ).catch((e) => e);
    // no cookie -> null, not a throw
    expect(res).toBeNull();

    const r = await runWithDb(testDb as unknown as Db, async () =>
      auth.api.getSession({ headers: await headersFor(seeded.token) }),
    );
    expect(r?.user.email).toBe("editor@jknm.si");
    expect(to_app_session(r)?.user.id).toBe("u1");
    expect(to_app_session(r)?.expires).toMatch(/Z$/);
  });

  test("singleton resolves the db per request (two scopes, two dbs)", async () => {
    const auth = build(db as never);
    const other = await createTestDb(); // empty db: same cookie must NOT resolve
    const h = await headersFor(seeded.token);
    expect(
      await runWithDb(testDb as unknown as Db, () => auth.api.getSession({ headers: h })),
    ).not.toBeNull();
    expect(
      await runWithDb(other as unknown as Db, () => auth.api.getSession({ headers: h })),
    ).toBeNull();
  });

  test("singleton under concurrent scopes does not mix dbs", async () => {
    const auth = build(db as never);
    const other = await createTestDb();
    const h = await headersFor(seeded.token);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        runWithDb((i % 2 ? testDb : other) as unknown as Db, () =>
          auth.api.getSession({ headers: h }),
        ),
      ),
    );
    expect(results.map((r) => r !== null)).toEqual(
      Array.from({ length: 20 }, (_, i) => i % 2 === 1),
    );
  });

  test("per-request construction over the concrete db", async () => {
    const r = await runWithDb(testDb as unknown as Db, async () => {
      const auth = build(getDb() as never);
      return auth.api.getSession({ headers: await headersFor(seeded.token) });
    });
    expect(r?.user.id).toBe("u1");
  });

  test("rejects bad signature, wrong secret, expired and unknown tokens", async () => {
    const auth = build(db as never);
    const get = (h: Headers) =>
      runWithDb(testDb as unknown as Db, () => auth.api.getSession({ headers: h }));
    expect(
      await get(await headersFor(seeded.token, "another-secret-another-secret-0123456789")),
    ).toBeNull();
    expect(await get(await headersFor("tok-expired"))).toBeNull();
    expect(await get(await headersFor("tok-nope"))).toBeNull();
    expect(
      await get(new Headers({ cookie: "better-auth.session_token=tok-valid.AAAA", host: HOST })),
    ).toBeNull();
  });

  test("adapter write paths through the proxy: sign-out deletes the session", async () => {
    const auth = build(db as never);
    await runWithDb(testDb as unknown as Db, async () => {
      const res = await auth.handler(
        new Request(`http://${HOST}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            ...Object.fromEntries(await headersFor(seeded.token)),
            origin: `http://${HOST}`,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);
      const rows = await testDb
        .select()
        .from(tables.session)
        .where(eq(tables.session.token, "tok-valid"));
      expect(rows).toHaveLength(0);
    });
  });

  test("transaction path: adapter with transaction:true uses db.transaction on the proxy", async () => {
    // not enabled by default (drizzleAdapter config.transaction = false); here we only prove
    // that the proxy supports the call the adapter would make.
    await runWithDb(testDb as unknown as Db, async () => {
      await db.transaction(async (tx) => {
        const rows = await tx.select().from(tables.user).where(eq(tables.user.id, "u1"));
        expect(rows).toHaveLength(1);
      });
      // relational query builder (adapter findOne/findMany use db.query[model] when joins are on)
      expect(typeof db.query).toBe("object");
    });
  });

  test("background task handler is called (waitUntil shape)", async () => {
    const pending: Promise<unknown>[] = [];
    const auth = build(db as never, { waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await runWithDb(testDb as unknown as Db, async () =>
      auth.api.getSession({ headers: await headersFor(seeded.token) }),
    );
    // getSession itself may or may not schedule background work; record the count
    console.log("[spike] background tasks scheduled by getSession:", pending.length);
    await Promise.all(pending);
  });

  test("no account.issuer needed: account insert/select without that column", async () => {
    await testDb.insert(tables.account).values({
      id: "a1",
      userId: "u1",
      accountId: "google-sub-1",
      providerId: "google",
    });
    const rows = await testDb.select().from(tables.account);
    expect(Object.keys(rows[0]!)).not.toContain("issuer");
  });
});
