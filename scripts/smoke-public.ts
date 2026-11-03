/**
 * HTTP contract check for the public read path against a built Worker
 * (`vp build && vp preview`) over a database seeded by `scripts/seed-smoke.ts`.
 * Asserts status and Location, and that the response store admits the response
 * (the second request is a `HIT`). Prints `x-vinext-cache` for every request.
 * `cached: false` means the response must never be stored (junk slugs cannot grow the store).
 * Usage: BASE_URL=http://localhost:4180 vpx scripts/smoke-public.ts
 */
export {};
const base = process.env.BASE_URL ?? "http://localhost:4180";

const cases: { path: string; status: number; location?: string; cached?: boolean }[] = [
  { path: "/novica/pub-a", status: 200, cached: true },
  { path: "/novica/renamed-b-new", status: 200, cached: true },
  { path: "/novica/renamed-b-old", status: 308, location: "/novica/renamed-b-new", cached: true },
  // Visibility before canonicality: hidden articles never redirect.
  { path: "/novica/draft-x", status: 404, cached: false },
  { path: "/novica/archived-x", status: 404, cached: false },
  { path: "/novica/deleted-x", status: 404, cached: false },
  { path: "/novica/content-x", status: 404, cached: false },
  { path: "/novica/unknown-slug", status: 404, cached: false },
  { path: "/novica/junk-2", status: 404, cached: false },
  // The framework rejects invalid percent-encoding itself, before routing.
  { path: "/novica/%E0%A4%A", status: 400 },
];

let failed = 0;
async function get(path: string) {
  const res = await fetch(base + path, { redirect: "manual" });
  await res.arrayBuffer();
  return {
    status: res.status,
    location: res.headers.get("location"),
    cache: res.headers.get("x-vinext-cache"),
  };
}

for (const c of cases) {
  const first = await get(c.path);
  const second = await get(c.path);
  const problems: string[] = [];
  if (first.status !== c.status) problems.push(`status ${first.status} != ${c.status}`);
  if (c.location && first.location !== c.location) problems.push(`location ${first.location}`);
  if (c.cached === false && second.cache === "HIT") problems.push("404 was stored");
  if (c.cached && second.cache !== "HIT") problems.push(`second request not HIT (${second.cache})`);
  if (problems.length) failed += 1;
  console.log(
    `${problems.length ? "FAIL" : "ok  "} ${c.path} ${first.status} ${first.cache ?? "-"} -> ${second.cache ?? "-"} ${problems.join("; ")}`,
  );
}
// Fonts must be self-hosted: vinext silently falls back to the Google CDN when its
// build-time download fails, and Workers Builds always re-downloads.
{
  const html = await (await fetch(base + "/")).text();
  const font = html.match(
    /<link rel="preload" href="(\/_next\/static\/_vinext_fonts\/[^"]+\.woff2)"/,
  )?.[1];
  const problems: string[] = [];
  if (!font) problems.push("no preload of a self-hosted font");
  if (html.includes("fonts.googleapis.com") || html.includes("fonts.gstatic.com"))
    problems.push("HTML references the Google font CDN");
  if (font) {
    const res = await fetch(base + font);
    if (res.status !== 200) problems.push(`font ${res.status}`);
    if (!res.headers.get("cache-control")?.includes("immutable"))
      problems.push("font not immutable");
  }
  if (problems.length) failed += 1;
  console.log(`${problems.length ? "FAIL" : "ok  "} fonts self-hosted ${problems.join("; ")}`);
}
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
