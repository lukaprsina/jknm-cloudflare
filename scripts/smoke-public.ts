/**
 * HTTP contract check for the public read path against a built Worker
 * (`vp build && vp preview`) over a database seeded by `scripts/seed-smoke.ts`.
 * Asserts status and Location, and that the response store admits the response
 * (the second request is a `HIT`). Prints `x-vinext-cache` for every request.
 * `cached: false` means the response must never be stored (junk slugs cannot grow the store).
 * Usage: BASE_URL=http://localhost:4180 vpx scripts/smoke-public.ts
 */
import { CONTENT_PAGES } from "../lib/content-pages";

const base = process.env.BASE_URL ?? "http://localhost:4180";

const cases: {
  path: string;
  status: number;
  location?: string;
  cached?: boolean;
  /** Text the body must contain. */
  includes?: string;
}[] = [
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
  // The club pages: stored like articles, one route driven by the fixed slug list.
  ...CONTENT_PAGES.map(({ slug }) => ({
    path: `/${slug}`,
    status: 200,
    cached: true,
  })),
  // Not in the list: a real 404 that is never stored, inside the site shell (the skip link).
  { path: "/foo", status: 404, cached: false, includes: "Preskoči na vsebino" },
  // A route miss renders the root not-found (no site shell), single segments the shell's.
  { path: "/a/b/c", status: 404, cached: false, includes: "Stran ne obstaja" },
  // Metadata routes and the files behind them.
  { path: "/sitemap.xml", status: 200, cached: true },
  { path: "/robots.txt", status: 200, cached: true },
  { path: "/manifest.webmanifest", status: 200, cached: true },
  ...[
    "/web-app-manifest-192x192.png",
    "/web-app-manifest-512x512.png",
    "/opengraph-image.png",
    "/apple-icon.png",
    "/icon0.svg",
    "/icon1.png",
    "/favicon.ico",
  ].map((path) => ({ path, status: 200 })),
  // The top-level club route must not shadow the static routes beside it.
  { path: "/prijava", status: 200 },
  // The framework rejects invalid percent-encoding itself, before routing.
  { path: "/novica/%E0%A4%A", status: 400 },
  // Old `/si` links: never stored (a stored redirect could not be purged). Hidden ids are 410.
  { path: "/si?id=101", status: 308, location: "/novica/pub-a", cached: false },
  { path: "/si?id=102", status: 308, location: "/novica/renamed-b-new", cached: false },
  // `/si/?id=` is what old links look like: the framework drops the slash first, keeping the query.
  { path: "/si/?id=101", status: 308, location: "/si?id=101", cached: false },
  { path: "/si?id=101&l=2019", status: 308, location: "/novica/pub-a", cached: false },
  { path: "/si?id=103", status: 410, cached: false },
  { path: "/si?id=104", status: 410, cached: false },
  { path: "/si?id=105", status: 410, cached: false },
  { path: "/si?id=999999", status: 410, cached: false },
  { path: "/si?id=2147483648", status: 410, cached: false },
  { path: "/si?id=abc", status: 410, cached: false },
  { path: "/si", status: 301, location: "/", cached: false },
  { path: "/si?id=", status: 301, location: "/", cached: false },
  { path: "/si/klub", status: 308, location: "/klub", cached: false },
  { path: "/si/klub/zgodovina", status: 308, location: "/zgodovina", cached: false },
  { path: "/si/jame", status: 410, cached: false },
];

let failed = 0;
async function get(path: string) {
  const res = await fetch(base + path, { redirect: "manual" });
  return {
    body: await res.text(),
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
  if (c.includes && !first.body.includes(c.includes)) problems.push(`body lacks "${c.includes}"`);
  if (c.location && first.location !== c.location) problems.push(`location ${first.location}`);
  if (c.cached === false && second.cache === "HIT") problems.push("404 was stored");
  if (c.cached && second.cache !== "HIT") problems.push(`second request not HIT (${second.cache})`);
  if (problems.length) failed += 1;
  console.log(
    `${problems.length ? "FAIL" : "ok  "} ${c.path} ${first.status} ${first.cache ?? "-"} -> ${second.cache ?? "-"} ${problems.join("; ")}`,
  );
}
// The homepage: stored, newest first (filler-0 and filler-1 tie on the date), and paged.
{
  const first = await get("/");
  const second = await get("/");
  const html = await (await fetch(base + "/")).text();
  const slugs = [...html.matchAll(/href="\/novica\/([^"]+)"/g)].map((m) => m[1]);
  const problems: string[] = [];
  if (second.cache !== "HIT") problems.push(`second request not HIT (${second.cache})`);
  if (slugs.length !== 13) problems.push(`${slugs.length} cards, expected 13`);
  if (!slugs.slice(0, 2).every((slug) => /^filler-[01]$/.test(slug ?? "")))
    problems.push(`not newest first: ${slugs.slice(0, 2).join(",")}`);
  if (slugs.some((slug) => /draft|archived|deleted|content/.test(slug ?? "")))
    problems.push("a hidden article is listed");
  if (!html.includes("Več novic")) problems.push("no load-more button");
  if (problems.length) failed += 1;
  console.log(
    `${problems.length ? "FAIL" : "ok  "} / ${first.status} ${first.cache ?? "-"} -> ${second.cache ?? "-"} ${problems.join("; ")}`,
  );
}
// Metadata: the sitemap lists exactly the public news under primary slugs plus the static
// pages; robots disallows everything; every page carries the default preview image and icons.
{
  const manifest = (await (await fetch(base + "/manifest.webmanifest")).json()) as {
    start_url: string;
  };
  const sitemap = await (await fetch(base + "/sitemap.xml")).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
  const robots = await (await fetch(base + "/robots.txt")).text();
  const head = await (await fetch(base + "/novica/pub-a")).text();
  const home = await (await fetch(base + "/")).text();
  const problems: string[] = [];
  if (manifest.start_url !== "/") problems.push("manifest start_url");
  for (const path of ["/", ...CONTENT_PAGES.map((p) => `/${p.slug}`), "/novica/pub-a"])
    if (!locs.includes(path)) problems.push(`sitemap lacks ${path}`);
  // The static pages plus the seeded news: pub-a, renamed-b-new and the 24 fillers.
  const expected = 1 + CONTENT_PAGES.length + 2 + 24;
  if (locs.length !== expected) problems.push(`${locs.length} sitemap urls, expected ${expected}`);
  if (locs.some((path) => /draft|archived|deleted|content|renamed-b-old/.test(path)))
    problems.push("sitemap lists a hidden or aliased article");
  if (!/^Disallow: \/$/m.test(robots)) problems.push("robots does not disallow all");
  // pub-a has no thumbnail, so the default preview image must be served.
  const preview = head.match(/property="og:image" content="([^"]+)"/)?.[1];
  if (!preview?.includes("/opengraph-image.png")) problems.push(`og:image is ${preview}`);
  if (!/<meta[^>]*og:image:alt/.test(head)) problems.push("article lacks og:image:alt");
  for (const [name, html] of [
    ["article", head],
    ["home", home],
  ] as const) {
    for (const tag of ["og:image", "twitter:image"])
      if (!html.includes(`property="${tag}"`) && !html.includes(`name="${tag}"`))
        problems.push(`${name} lacks ${tag}`);
    for (const rel of ["icon", "apple-touch-icon", "manifest"])
      if (!new RegExp(`<link[^>]*rel="${rel}"`).test(html))
        problems.push(`${name} lacks ${rel} link`);
  }
  if (problems.length) failed += 1;
  console.log(`${problems.length ? "FAIL" : "ok  "} metadata ${problems.join("; ")}`);
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
