/**
 * Responses for old `/si/*` links. A browser caches a permanent 308 or a 410
 * heuristically and indefinitely, so ask it to revalidate: an id that is
 * republished later recovers. The routes must not export `revalidate`,
 * `dynamic = "force-static"` or `generateStaticParams`: any of them makes vinext
 * store the response, and nothing could purge a stored redirect.
 */
const REVALIDATE_HEADERS = { "Cache-Control": "public, max-age=0, must-revalidate" };

/** A relative `Location`, so no origin is derived from the request. */
export const legacy_redirect = (path: string, status: 301 | 308 = 308) =>
  new Response(null, { status, headers: { ...REVALIDATE_HEADERS, Location: path } });

export const legacy_gone = () => new Response(null, { status: 410, headers: REVALIDATE_HEADERS });
