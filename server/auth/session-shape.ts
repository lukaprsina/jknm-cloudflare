/**
 * The adapter that keeps this migration small: better-auth returns
 * `{ session, user }`, the app has always passed around NextAuth's
 * `{ user, expires }`. Translating here means the ~15 server-side reads and
 * every component taking a `Session` prop compile unchanged.
 *
 * Pure and library-free on purpose — the input type is structural so tests can
 * hand-write a fixture without booting better-auth.
 */

/** The session shape the rest of the app consumes. */
export interface Session {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
  /** ISO-8601, as NextAuth's `expires` was. */
  expires: string;
}

/** The subset of better-auth's `getSession` result this adapter reads. */
export interface BetterAuthSessionResult {
  session: { expiresAt: Date };
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function to_app_session(result: BetterAuthSessionResult | null | undefined): Session | null {
  if (!result) return null;

  return {
    user: {
      id: result.user.id,
      name: result.user.name ?? null,
      email: result.user.email ?? null,
      image: result.user.image ?? null,
    },
    expires: result.session.expiresAt.toISOString(),
  };
}
