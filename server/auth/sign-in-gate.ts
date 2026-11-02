/**
 * The whole "who may enter" rule, as one pure function.
 *
 * better-auth has no equivalent of NextAuth's `signIn` callback, so the wiring
 * lives in a custom `getUserInfo` on the Google provider (see `./create-auth.ts`).
 * That callback holds the wiring; this holds the rule — which is why the rule
 * is testable at all. Keep it free of database, request and library access.
 */

import { WORKSPACE_EMAIL_DOMAIN } from "../../lib/domains";

/** The one domain admins sign in from. */
export const ALLOWED_EMAIL_DOMAIN = `@${WORKSPACE_EMAIL_DOMAIN}`;

export interface SignInCandidate {
  email: string | null | undefined;
  /** The provider's own claim that it owns the address — not our column. */
  email_verified: unknown;
}

export function is_allowed_sign_in({ email, email_verified }: SignInCandidate): boolean {
  // Strict: the claim comes from decoded JSON, so a string like "false" must not count as verified.
  if (email_verified !== true) return false;
  if (!email) return false;
  return email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN);
}
