/**
 * The whole "who may enter" rule, as one pure function.
 *
 * better-auth has no equivalent of NextAuth's `signIn` callback, so the wiring
 * lives in a custom `getUserInfo` on the Google provider (see `./index.ts`).
 * That callback holds the wiring; this holds the rule — which is why the rule
 * is testable at all. Keep it free of database, request and library access.
 */

const WORKSPACE_EMAIL_DOMAIN = "jknm.si"; // old: ~/lib/domains

/** The one domain club editors sign in from. */
export const ALLOWED_EMAIL_DOMAIN = `@${WORKSPACE_EMAIL_DOMAIN}`;

export interface SignInCandidate {
  /** The OAuth provider id, e.g. `"google"`. */
  provider: string;
  email: string | null | undefined;
  /** The provider's own claim that it owns the address — not our column. */
  email_verified: boolean | null | undefined;
}

export function is_allowed_sign_in({ provider, email, email_verified }: SignInCandidate): boolean {
  if (provider !== "google") return false;
  if (!email_verified) return false;
  if (!email) return false;
  return email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN);
}
