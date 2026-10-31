// Runs, in Node, (a) the OLD googleapis implementation (copied logic from
// .references/jknm/src/server/author/sync_members.ts) and (b) the new fetch+jose module, with
// the same credentials, and compares. Prints counts/hashes only. READ-ONLY (users.list).
// googleapis is NOT a dependency of this repo: set GOOGLE_OLD_DIR to a scratch dir with it installed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const line = readFileSync(".env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("JKNM_SERVICE_ACCOUNT_CREDENTIALS="));
const creds = line
  .slice(line.indexOf("=") + 1)
  .trim()
  .replace(/^"|"$/g, "");
const wl = readFileSync(".env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("JKNM_WORKSPACE_ID="));
const customer = wl
  .slice(wl.indexOf("=") + 1)
  .trim()
  .replace(/^"|"$/g, "");
const mask = (e) => (e ? e.replace(/^(.{2}).*@/, "$1***@") : e);
const digest = (ms) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        ms.map((m) => [m.google_id, m.first_name, m.last_name, m.email, m.image]).sort(),
      ),
    )
    .digest("hex")
    .slice(0, 12);

// (a) old implementation
const require = createRequire(process.env.GOOGLE_OLD_DIR + "/");
const { google } = require("googleapis");
async function old() {
  const credentials_json = JSON.parse(Buffer.from(creds, "base64").toString("utf8"));
  const t0 = performance.now();
  const client = await google.auth.getClient({
    credentials: credentials_json,
    scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
  });
  const service = google.admin({ version: "directory_v1", auth: client });
  const members = [];
  let pages = 0;
  let page_token;
  do {
    const r = await service.users.list({ customer, maxResults: 200, pageToken: page_token });
    pages++;
    for (const u of r.data.users) {
      members.push({
        google_id: u.id,
        first_name: u.name?.givenName?.trim(),
        last_name: u.name?.familyName?.trim(),
        email: u.primaryEmail ?? null,
        image: u.thumbnailPhotoUrl ?? null,
      });
    }
    page_token = r.data.nextPageToken ?? undefined;
  } while (page_token);
  return { members, pages, ms: Math.round(performance.now() - t0) };
}
const o = await old();
console.log("OLD googleapis:", {
  count: o.members.length,
  pages: o.pages,
  ms: o.ms,
  digest: digest(o.members),
});

// (b) new module
const mod = await import(pathToFileURL(process.cwd() + "/lib/spike/google-directory.ts").href);
for (const maxResults of [200, 5]) {
  const timings = {};
  let pages = 0;
  const t0 = performance.now();
  const ms = await mod.fetchGoogleMembers(creds, customer, {
    timings,
    maxResults,
    onPage: () => pages++,
  });
  console.log(`NEW fetch+jose (maxResults=${maxResults}):`, {
    count: ms.length,
    pages,
    totalMs: Math.round(performance.now() - t0),
    digest: digest(ms),
    timings: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, +v.toFixed(1)])),
  });
  if (maxResults === 200) {
    const oldIds = new Set(o.members.map((m) => m.google_id));
    console.log(
      "ids equal:",
      ms.length === oldIds.size && ms.every((m) => oldIds.has(m.google_id)),
      "| sample:",
      {
        id: ms[0].google_id.slice(0, 4) + "…",
        first: ms[0].first_name[0] + "…",
        email: mask(ms[0].email),
        hasImage: !!ms[0].image,
      },
    );
    console.log(
      "field names:",
      Object.keys(ms[0]).join(","),
      "| suspended-visible: n/a (not mapped)",
    );
  }
}
