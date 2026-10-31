// better-auth tables, ported from .references/jknm/src/server/db/schema.ts WITHOUT the
// obsolete `account.issuer` column and `account_issuer_account_id_uidx` index (better-auth
// >= 1.7.3 identifies accounts by providerId + accountId).
//
// Property names are better-auth's field names (the drizzle adapter indexes tables by them);
// column strings stay snake_case like production.
//
// `createAuthTables(schemaName)` exists only for the spike: dev routes run against a scratch
// Postgres schema (`spike_tmp_auth`) so no production auth table is ever written.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgSchema,
  pgTable,
  text,
  timestamp,
  varchar,
  type PgTableFn,
} from "drizzle-orm/pg-core";

export function createAuthTables(schemaName?: string) {
  const table: PgTableFn = schemaName
    ? (pgSchema(schemaName).table as unknown as PgTableFn)
    : pgTable;
  const id = () =>
    varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID());
  const createdAt = () =>
    timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull();
  const updatedAt = () =>
    timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date())
      .notNull();

  const users = table("user", {
    id: id(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: varchar("image", { length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  });

  const accounts = table(
    "account",
    {
      id: id(),
      userId: varchar("user_id", { length: 255 })
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      accountId: varchar("account_id", { length: 255 }).notNull(),
      providerId: varchar("provider_id", { length: 255 }).notNull(),
      accessToken: text("access_token"),
      refreshToken: text("refresh_token"),
      accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
      refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
      scope: text("scope"),
      idToken: text("id_token"),
      password: text("password"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (a) => [index("account_user_id_idx").on(a.userId)],
  );

  const sessions = table(
    "session",
    {
      id: id(),
      userId: varchar("user_id", { length: 255 })
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      token: varchar("token", { length: 255 }).notNull().unique(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      ipAddress: text("ip_address"),
      userAgent: text("user_agent"),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (s) => [index("session_user_id_idx").on(s.userId)],
  );

  const verification = table("verification", {
    id: id(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  });

  return { user: users, session: sessions, account: accounts, verification };
}

export type AuthTables = ReturnType<typeof createAuthTables>;
