// better-auth config ported from .references/jknm/src/server/auth/index.ts.
// Pure factory: no `cloudflare:workers`, no `next/*`, no module-scope env reads, so the pglite
// test can build it with explicit config. Differences from the old file are marked `CHANGED`.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { GoogleProfile } from "better-auth/social-providers";
import { decodeJwt } from "jose";
import type { AuthTables } from "./tables";
import { to_app_session } from "./session-shape";
import { is_allowed_sign_in } from "./sign-in-gate";

export { to_app_session };

export interface CreateAuthOptions {
  /** The db object handed to drizzleAdapter: the ALS proxy, or a concrete per-request db. */
  db: Parameters<typeof drizzleAdapter>[0];
  tables: AuthTables;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
  allowedHosts: string[];
  /** CHANGED: optional. On Workers pass `waitUntil` from `cloudflare:workers`. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** CHANGED: explicit so Secure does not depend on NODE_ENV being set in the Worker. */
  useSecureCookies?: boolean;
}

export function createAuth(o: CreateAuthOptions) {
  return betterAuth({
    baseURL: { allowedHosts: o.allowedHosts },
    secret: o.secret,
    database: drizzleAdapter(o.db, {
      provider: "pg",
      schema: o.tables, // keys user/session/account/verification = better-auth model names
    }),
    // CHANGED: no account.issuer column/index (>= 1.7.3).
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    advanced: {
      useSecureCookies: o.useSecureCookies,
      backgroundTasks: o.waitUntil ? { handler: o.waitUntil } : undefined,
    },
    socialProviders: {
      google: {
        clientId: o.googleClientId,
        clientSecret: o.googleClientSecret,
        getUserInfo: async (token) => {
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
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
