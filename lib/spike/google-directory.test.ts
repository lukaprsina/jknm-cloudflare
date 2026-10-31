import { decodeJwt, exportSPKI, importSPKI, jwtVerify } from "jose";
import { describe, expect, test } from "vite-plus/test";
import {
  GoogleApiError,
  getAccessToken,
  listMembers,
  parseServiceAccount,
} from "./google-directory";

async function makeKey() {
  const kp = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
    publicKey: kp.publicKey,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("google-directory (fetch + jose)", () => {
  test("signs an RS256 assertion with the right claims and exchanges it", async () => {
    const { pem, publicKey } = await makeKey();
    let seen: URLSearchParams | undefined;
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe("https://oauth2.googleapis.com/token");
      seen = new URLSearchParams(init!.body as URLSearchParams);
      return json({ access_token: "tok", expires_in: 3599 });
    }) as typeof fetch;
    const r = await getAccessToken(
      { client_email: "sa@proj.iam.gserviceaccount.com", private_key: pem },
      { fetch: fakeFetch },
    );
    expect(r).toEqual({ token: "tok", expiresIn: 3599 });
    expect(seen!.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = seen!.get("assertion")!;
    const { payload, protectedHeader } = await jwtVerify(
      assertion,
      await importSPKI(await exportSPKI(publicKey), "RS256"),
    );
    expect(protectedHeader).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("sa@proj.iam.gserviceaccount.com");
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token");
    expect(payload.scope).toBe("https://www.googleapis.com/auth/admin.directory.user.readonly");
    expect(payload.sub).toBeUndefined(); // old code did not impersonate
    expect(payload.exp! - payload.iat!).toBe(3600);
  });

  test("sub is only set when asked (domain-wide delegation)", async () => {
    const { pem } = await makeKey();
    let assertion = "";
    const fakeFetch = (async (_u: unknown, init?: RequestInit) => {
      assertion = new URLSearchParams(init!.body as URLSearchParams).get("assertion")!;
      return json({ access_token: "t" });
    }) as typeof fetch;
    await getAccessToken(
      { client_email: "a@b", private_key: pem },
      { sub: "admin@x.si", fetch: fakeFetch },
    );
    expect(decodeJwt(assertion).sub).toBe("admin@x.si");
  });

  test("private_key with literal \\n (double-escaped JSON) is normalised", async () => {
    const { pem } = await makeKey();
    const escaped = btoa(
      JSON.stringify({ client_email: "a@b", private_key: pem.replace(/\n/g, "\\n") }),
    );
    const sa = parseServiceAccount(escaped);
    expect(sa.private_key).toBe(pem);
    await expect(
      getAccessToken(sa, { fetch: (async () => json({ access_token: "t" })) as typeof fetch }),
    ).resolves.toBeDefined();
  });

  test("token endpoint error becomes GoogleApiError", async () => {
    const { pem } = await makeKey();
    const f = (async () =>
      json(
        { error: "invalid_grant", error_description: "Invalid email or User ID" },
        400,
      )) as typeof fetch;
    await expect(
      getAccessToken({ client_email: "a@b", private_key: pem }, { fetch: f }),
    ).rejects.toMatchObject({
      step: "token",
      status: 400,
    });
  });

  test("follows nextPageToken and applies the old trimming/validation rules", async () => {
    const calls: string[] = [];
    const f = (async (url: URL, init?: RequestInit) => {
      calls.push(url.searchParams.get("pageToken") ?? "-");
      expect(new Headers(init!.headers).get("authorization")).toBe("Bearer T");
      expect(url.searchParams.get("customer")).toBe("C1");
      expect(url.searchParams.get("maxResults")).toBe("2");
      const p = url.searchParams.get("pageToken");
      if (!p)
        return json({
          users: [
            { id: "1", primaryEmail: "a@x.si", name: { givenName: " Ana ", familyName: "Novak " } },
            { id: "2", name: { givenName: "B", familyName: "C" }, thumbnailPhotoUrl: "u" },
          ],
          nextPageToken: "p2",
        });
      return json({ users: [{ id: "3", name: { givenName: "D", familyName: "E" } }] });
    }) as unknown as typeof fetch;
    const m = await listMembers("T", { customer: "C1", maxResults: 2, fetch: f });
    expect(calls).toEqual(["-", "p2"]);
    expect(m.map((x) => x.google_id)).toEqual(["1", "2", "3"]);
    expect(m[0]).toEqual({
      google_id: "1",
      first_name: "Ana",
      last_name: "Novak",
      email: "a@x.si",
      image: null,
    });
    expect(m[1]!.image).toBe("u");
  });

  test("rejects duplicate ids, missing names and API errors", async () => {
    const mk = (users: unknown) => (async () => json({ users })) as unknown as typeof fetch;
    const u = { id: "1", name: { givenName: "A", familyName: "B" } };
    await expect(listMembers("T", { customer: "C", fetch: mk([u, u]) })).rejects.toThrow(
      /Duplicate/,
    );
    await expect(
      listMembers("T", { customer: "C", fetch: mk([{ id: "1", name: {} }]) }),
    ).rejects.toThrow(/given\/family/);
    const bad = (async () =>
      json({ error: { status: "UNAUTHENTICATED", message: "x" } }, 401)) as typeof fetch;
    await expect(listMembers("T", { customer: "C", fetch: bad })).rejects.toBeInstanceOf(
      GoogleApiError,
    );
  });
});
