/**
 * Old `www.jknm.si/si/*` URLs came in two shapes: `?id=<legacy_id>` article
 * links (`is_valid_legacy_id`, then the public-read module's `by_legacy_id`) and
 * static section paths from the pre-rewrite classic-ASP site
 * (`resolve_legacy_static_path`).
 *
 * Only `klub`, `klub/zgodovina`, `publikacije`, `raziskovanje`, `varstvo`,
 * `etc/kontakt` and `etc/iskanje` have a live equivalent; the admin kept those
 * updated. Everything else was deemed outdated and 410s: `jame` and `kataster`
 * now live on JZS's site (a redirect would only leak link equity to another
 * domain), and `izobrazevanje/kodeks` is folded into the `/klub` text with no
 * single page to point at. Any `klub/<x>` other than `zgodovina` falls through
 * to `/klub`, which is close enough to be worth a redirect.
 *
 * `etc/kontakt` and `etc/iskanje` target routes that land in later steps.
 */

export type LegacyStaticPathResolution =
  | { outcome: "redirect"; path: string }
  | { outcome: "gone" };

export function resolve_legacy_static_path(segments: string[]): LegacyStaticPathResolution {
  const [first, second] = segments;

  switch (first) {
    case "klub":
      return { outcome: "redirect", path: second === "zgodovina" ? "/zgodovina" : "/klub" };
    case "publikacije":
      return { outcome: "redirect", path: "/publiciranje" };
    case "raziskovanje":
      return { outcome: "redirect", path: "/raziskovanje" };
    case "varstvo":
      return { outcome: "redirect", path: "/varstvo" };
    case "etc":
      if (second === "kontakt") return { outcome: "redirect", path: "/stik-z-nami" };
      if (second === "iskanje") return { outcome: "redirect", path: "/arhiv" };
      return { outcome: "gone" };
    default:
      return { outcome: "gone" };
  }
}

// Postgres `integer` (what `Article.legacy_id` is) tops out here; a larger id
// overflows the column and the driver throws, turning "never existed" into a 500.
const PG_INT_MAX = 2147483647;

const LEGACY_ID_RE = /^\d+$/;

/** Whether a `?id=` query param is worth looking up. */
export function is_valid_legacy_id(id: string): boolean {
  return LEGACY_ID_RE.test(id) && Number(id) <= PG_INT_MAX;
}
