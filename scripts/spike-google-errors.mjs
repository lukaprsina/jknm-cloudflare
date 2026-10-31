// Error-shape probes (Node). Prints status/reason only.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const rd = (k) => {
  const l = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((x) => x.startsWith(k + "="));
  return l
    .slice(l.indexOf("=") + 1)
    .trim()
    .replace(/^"|"$/g, "");
};
const creds = rd("JKNM_SERVICE_ACCOUNT_CREDENTIALS"),
  customer = rd("JKNM_WORKSPACE_ID");
const m = await import(pathToFileURL(process.cwd() + "/lib/spike/google-directory.ts").href);
const sa = m.parseServiceAccount(creds);
const tryIt = async (label, fn) => {
  try {
    const r = await fn();
    console.log(label, "->", r);
  } catch (e) {
    console.log(
      label,
      "->",
      e.constructor.name,
      e.step ?? "",
      e.status ?? "",
      String(e.reason ?? e.message).slice(0, 160),
    );
  }
};
await tryIt("nonexistent sub (DWD probe)", () =>
  m.getAccessToken(sa, { sub: "no-such-user-spike@jknm.si" }),
);
await tryIt("bad scope", () =>
  m.getAccessToken(sa, { scope: "https://www.googleapis.com/auth/not.a.scope" }),
);
await tryIt("literal-backslash-n key, with normalisation in parseServiceAccount", async () => {
  const escaped = JSON.stringify({ ...sa, private_key: sa.private_key.replace(/\n/g, "\\n") });
  const re = m.parseServiceAccount(Buffer.from(escaped).toString("base64"));
  return m.getAccessToken(re).then(() => "ok");
});
await tryIt("literal-backslash-n key, raw jose importPKCS8 (no normalisation)", async () => {
  const { importPKCS8 } = await import("jose");
  return importPKCS8(sa.private_key.replace(/\n/g, "\\n"), "RS256").then(() => "ok");
});
await tryIt("key without trailing newline", () =>
  m.getAccessToken({ ...sa, private_key: sa.private_key.trimEnd() }).then(() => "ok"),
);
await tryIt("key with CRLF", () =>
  m.getAccessToken({ ...sa, private_key: sa.private_key.replace(/\n/g, "\r\n") }).then(() => "ok"),
);
await tryIt("key on one line, no newlines at all", () =>
  m.getAccessToken({ ...sa, private_key: sa.private_key.replace(/\n/g, "") }).then(() => "ok"),
);
const { token } = await m.getAccessToken(sa);
await tryIt("wrong customer id", () => m.listMembers(token, { customer: "C000000000" }));
await tryIt("garbage bearer", () => m.listMembers("garbage", { customer }));
