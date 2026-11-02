import type { GoogleProfile } from "better-auth/social-providers";
import { decodeJwt } from "jose";
import { is_allowed_sign_in } from "./sign-in-gate";

/**
 * better-auth has no `signIn` callback, so the gate runs here, as Google's
 * `getUserInfo`: returning `null` turns the sign-in away. The ID token comes
 * straight from Google's token endpoint over TLS, so decoding without
 * verifying the signature is what better-auth's own provider does too.
 */
export async function google_user_info(token: { idToken?: string }) {
  if (!token.idToken) return null;
  const profile = decodeJwt(token.idToken) as unknown as GoogleProfile;
  if (
    !is_allowed_sign_in({
      provider: "google",
      email: profile.email,
      email_verified: profile.email_verified,
    })
  ) {
    return null;
  }
  return {
    user: {
      name: profile.name,
      email: profile.email,
      image: profile.picture,
      emailVerified: profile.email_verified,
    },
    data: profile,
  };
}
