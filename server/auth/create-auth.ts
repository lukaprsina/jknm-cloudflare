import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "../db";
import { accounts, sessions, users, verification } from "../db/schema";
import { google_user_info } from "./google-user";

export interface CreateAuthOptions {
  /** Passed lazily to better-auth: the ambient `db` proxy works, it is only touched per request. */
  db: Db;
  secret: string;
  google: { client_id: string; client_secret: string };
  /** Every host that may start a sign-in, `*` wildcards allowed. */
  allowed_hosts: string[];
  /**
   * Origin used when the request has no allowed host: outside a request
   * (Cron/Queue calling `auth.api.*`) or from a host not in `allowed_hosts`.
   * A foreign `Host` header therefore never reaches a redirect URI.
   */
  fallback_origin: string;
  /** Explicit: Workers have no `NODE_ENV`, so better-auth would never set `Secure` by itself. */
  secure_cookies: boolean;
}

/**
 * Pure factory: no `cloudflare:workers`, no `next/*`, no env reads. Account
 * rows carry no `issuer` (better-auth >= 1.7.3 identifies accounts by
 * provider + account id).
 */
export function create_auth(options: CreateAuthOptions) {
  return betterAuth({
    baseURL: { allowedHosts: options.allowed_hosts, fallback: options.fallback_origin },
    secret: options.secret,
    database: drizzleAdapter(options.db, {
      provider: "pg",
      // Keys are better-auth's model names.
      schema: { user: users, session: sessions, account: accounts, verification },
    }),
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    advanced: {
      useSecureCookies: options.secure_cookies,
    },
    socialProviders: {
      google: {
        clientId: options.google.client_id,
        clientSecret: options.google.client_secret,
        getUserInfo: google_user_info,
      },
    },
  });
}

export type Auth = ReturnType<typeof create_auth>;
