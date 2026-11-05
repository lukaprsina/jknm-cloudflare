/**
 * What the public read path promises, against a built Worker.
 *   E2E_URL=http://localhost:4180 SEEDED=1 vp test e2e   (preview over `scripts/seed-smoke.ts`)
 *   E2E_URL=https://<origin> vp test e2e                 (deployed: only the cases that need no seed)
 * `cached` is the response-store contract: true means the page ends up a `HIT`, false means it is
 * never stored (junk slugs must not grow the store).
 */
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { CONTENT_PAGES } from "../lib/content-pages";
import { base, get, never_hit, seeded, until_hit } from "./helpers";

type Case = {
  path: string;
  status: number;
  location?: string;
  cached?: boolean;
  /** Text the body must contain. */
  includes?: string;
  /** Needs the `seed-smoke.ts` data. */
  seeded?: true;
};

const cases: Case[] = [
  { path: "/novica/pub-a", status: 200, cached: true, seeded: true },
  { path: "/novica/renamed-b-new", status: 200, cached: true, seeded: true },
  {
    path: "/novica/renamed-b-old",
    status: 308,
    location: "/novica/renamed-b-new",
    cached: true,
    seeded: true,
  },
  // Visibility before canonicality: hidden articles never redirect.
  { path: "/novica/draft-x", status: 404, cached: false, seeded: true },
  { path: "/novica/archived-x", status: 404, cached: false, seeded: true },
  { path: "/novica/deleted-x", status: 404, cached: false, seeded: true },
  { path: "/novica/content-x", status: 404, cached: false, seeded: true },
  { path: "/novica/unknown-slug", status: 404, cached: false },
  { path: "/novica/junk-2", status: 404, cached: false },
  // The club pages: stored like articles, one route driven by the fixed slug list.
  ...CONTENT_PAGES.map(({ slug }) => ({ path: `/${slug}`, status: 200, cached: true })),
  // Not in the list: a real 404 inside the site shell (the skip link), never stored.
  { path: "/foo", status: 404, cached: false, includes: "Preskoči na vsebino" },
  // A route miss renders the root not-found (no site shell).
  { path: "/a/b/c", status: 404, cached: false, includes: "Stran ne obstaja" },
  { path: "/", status: 200, cached: true },
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
  // Never reachable from outside: the internal gate answers 404.
  { path: "/api/internal/revalidate", status: 404 },
  // Old `/si` links are never stored (a stored redirect could not be purged); hidden ids are 410.
  { path: "/si?id=101", status: 308, location: "/novica/pub-a", cached: false, seeded: true },
  {
    path: "/si?id=102",
    status: 308,
    location: "/novica/renamed-b-new",
    cached: false,
    seeded: true,
  },
  // `/si/?id=` is what old links look like: the framework drops the slash first, keeping the query.
  { path: "/si/?id=101", status: 308, location: "/si?id=101", cached: false },
  {
    path: "/si?id=101&l=2019",
    status: 308,
    location: "/novica/pub-a",
    cached: false,
    seeded: true,
  },
  // Hidden (draft, archived, content), unknown, out of int range and malformed ids.
  ...["103", "104", "105"].map((id) => ({
    path: `/si?id=${id}`,
    status: 410,
    cached: false as const,
    seeded: true as const,
  })),
  ...["999999", "2147483648", "abc"].map((id) => ({
    path: `/si?id=${id}`,
    status: 410,
    cached: false as const,
  })),
  { path: "/si", status: 301, location: "/", cached: false },
  { path: "/si?id=", status: 301, location: "/", cached: false },
  { path: "/si/klub", status: 308, location: "/klub", cached: false },
  { path: "/si/klub/zgodovina", status: 308, location: "/zgodovina", cached: false },
  { path: "/si/jame", status: 410, cached: false },
];

const locs = (sitemap: string) => [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);

const applicable = cases.filter((c) => seeded || !c.seeded);

// One failure up front beats 20 confusing ones when the database is not the seeded one.
beforeAll(async () => {
  if (base && seeded && (await get("/novica/pub-a")).status !== 200)
    throw new Error("SEEDED=1 but /novica/pub-a is not 200: run scripts/seed-smoke.ts first");
});

describe.skipIf(!base)("public read path", { timeout: 30_000 }, () => {
  it.concurrent.for(applicable)("$path -> $status", async (c) => {
    const first = await get(c.path);
    expect(first.status).toBe(c.status);
    if (c.location) expect(first.location).toBe(c.location);
    if (c.includes) expect(first.body).toContain(c.includes);
    if (c.cached) {
      const hit = await until_hit(c.path);
      expect(hit.cache, "stored").toBe("HIT");
      // Browsers must revalidate a stored page, or a purge could not take effect at once.
      expect(hit.cache_control).toMatch(/private.*must-revalidate/);
    } else if (c.cached === false) {
      expect(await never_hit(c.path), "stored").toBe(true);
    }
  });

  it("builds absolute URLs from its own origin", async () => {
    const sitemap = await get("/sitemap.xml");
    const urls = locs(sitemap.body);
    expect(urls.length).toBeGreaterThan(0);
    for (const loc of urls) expect(loc.startsWith(`${base}/`), loc).toBe(true);
    const club = await get(`/${CONTENT_PAGES[0]!.slug}`);
    const canonical = club.body.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
    expect(canonical?.startsWith(`${base}/`), canonical).toBe(true);
  });
});

describe.skipIf(!base || !seeded)("seeded preview", () => {
  it("lists the homepage newest first and paged", async () => {
    const { body } = await get("/");
    const slugs = [...body.matchAll(/href="\/novica\/([^"]+)"/g)].map((m) => m[1]!);
    expect(slugs).toHaveLength(13);
    // filler-0 and filler-1 tie on the date.
    expect(slugs.slice(0, 2).sort()).toEqual(["filler-0", "filler-1"]);
    expect(slugs.filter((slug) => /draft|archived|deleted|content/.test(slug))).toEqual([]);
    expect(body).toContain("Več novic");
  });

  it("serves metadata", async () => {
    const [sitemap, robots, article, home, manifest] = await Promise.all([
      get("/sitemap.xml"),
      get("/robots.txt"),
      get("/novica/pub-a"),
      get("/"),
      get("/manifest.webmanifest"),
    ]);
    expect(JSON.parse(manifest.body).start_url).toBe("/");
    const paths = locs(sitemap.body).map((loc) => new URL(loc).pathname);
    expect(paths).toEqual(
      expect.arrayContaining(["/", ...CONTENT_PAGES.map((p) => `/${p.slug}`), "/novica/pub-a"]),
    );
    // Static pages plus the seeded news: pub-a, renamed-b-new and the 24 fillers.
    expect(paths).toHaveLength(1 + CONTENT_PAGES.length + 2 + 24);
    expect(
      paths.filter((path) => /draft|archived|deleted|content|renamed-b-old/.test(path)),
    ).toEqual([]);
    // Open before cutover, replaced by an allow-list afterwards: only the preview is pinned.
    expect(robots.body).toMatch(/^Disallow: \/$/m);
    // pub-a has no thumbnail, so the default preview image must be served.
    expect(article.body.match(/property="og:image" content="([^"]+)"/)?.[1]).toContain(
      "/opengraph-image.png",
    );
    expect(article.body).toMatch(/<meta[^>]*og:image:alt/);
    for (const html of [article.body, home.body]) {
      for (const tag of ["og:image", "twitter:image"])
        expect(html).toMatch(new RegExp(`(property|name)="${tag}"`));
      for (const rel of ["icon", "apple-touch-icon", "manifest"])
        expect(html).toMatch(new RegExp(`<link[^>]*rel="${rel}"`));
    }
  });

  // vinext silently falls back to the Google CDN when its build-time font download fails,
  // and Workers Builds always re-downloads.
  it("self-hosts fonts", async () => {
    const { body } = await get("/");
    expect(body).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    const font = body.match(
      /<link rel="preload" href="(\/_next\/static\/_vinext_fonts\/[^"]+\.woff2)"/,
    )?.[1];
    expect(font, "preload of a self-hosted font").toBeDefined();
    const res = await fetch(base + font);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });
});
