/**
 * Guards `/api/internal/*`. Those routes must only be reachable from this
 * isolate's own `queue`/`scheduled` handlers (where `next/cache`'s
 * `revalidateTag` is a no-op), never from the internet. Each isolate mints a
 * random token and sets it on its own in-process requests; external requests
 * to the prefix are rejected.
 */
export const INTERNAL_PREFIX = "/api/internal/";
/** Must match `app/api/internal/revalidate/route.ts`. */
export const REVALIDATE_PATH = `${INTERNAL_PREFIX}revalidate`;
export const INTERNAL_HEADER = "x-internal-token";

export function createInternalGate() {
  // Minted on first use: random values are not allowed in Worker global scope.
  let minted: string | undefined;
  const token = () => (minted ??= crypto.randomUUID());
  return {
    /** Headers to attach to an in-process request. */
    headers() {
      return { [INTERNAL_HEADER]: token() };
    },
    /** True when the request may proceed to the app. */
    allows(request: Request): boolean {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith(INTERNAL_PREFIX)) return true;
      return request.headers.get(INTERNAL_HEADER) === token();
    },
  };
}
