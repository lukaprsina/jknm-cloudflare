/**
 * The new site answers like the live one on a short, stable list of URLs: status and redirect
 * target only, so publishing does not make it flaky. Run before and after cutover:
 *   E2E_URL=https://jknm.org PARITY_REF=https://www.jknm.si vp test e2e/parity
 * A difference passes only when the row records it in `diverges`, with the reason.
 */
import { describe, expect, it } from "vite-plus/test";
import { base, get } from "./helpers";

const ref = (process.env.PARITY_REF ?? "").replace(/\/$/, "");

type Row = {
  path: string;
  /** What the new site does instead, on purpose. */
  diverges?: { status: number; reason: string };
};

const rows: Row[] = [
  { path: "/" },
  { path: "/klub" },
  { path: "/zgodovina" },
  { path: "/varstvo" },
  { path: "/sitemap.xml" },
  { path: "/robots.txt" },
  // Old articles whose text is unlikely to change.
  { path: "/novica/potop-v-termalni-izvir" },
  { path: "/novica/jamarski-tecaj-2008-tecaj-za-jamarja-pripravnika" },
  { path: "/novica/brezno-pod-studenskim-vrhom" },
  // Renamed slugs redirect to the new one. The last two never existed or are hidden: 404.
  { path: "/novica/caganka-projekt-gt400" },
  { path: "/novica/v-dolini-tihi-v-slugovi-jami" },
  { path: "/novica/zzz-junk" },
  { path: "/foo" },
  // Old `/si` links: the framework's slash redirect first, then the id, then the retired paths.
  { path: "/si/?id=1" },
  { path: "/si?id=1" },
  { path: "/si?id=10" },
  { path: "/si?id=11" },
  { path: "/si?id=999999" },
  { path: "/si?id=abc" },
  { path: "/si" },
  { path: "/si/jame" },
  { path: "/si/klub" },
  { path: "/si/etc/kontakt" },
  { path: "/si/etc/iskanje" },
  // The targets of the last two redirects ship in steps 7 and 8.
  { path: "/stik-z-nami", diverges: { status: 404, reason: "contact page ships in step 8" } },
  { path: "/arhiv", diverges: { status: 404, reason: "archive ships in step 7" } },
];

// The two sites have different hosts: compare redirects as paths.
const target = (location: string | null) =>
  location &&
  new URL(location, "https://x.invalid").pathname + new URL(location, "https://x.invalid").search;

describe.skipIf(!base || !ref)("parity with the live site", { timeout: 30_000 }, () => {
  it.concurrent.for(rows)("$path", async ({ path, diverges }) => {
    const [live, now] = await Promise.all([get(path, ref), get(path)]);
    expect(now.status, diverges?.reason).toBe(diverges?.status ?? live.status);
    // A divergence is pinned by status alone; its redirect target is not compared.
    if (!diverges) expect(target(now.location)).toBe(target(live.location));
  });
});
