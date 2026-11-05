import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export interface ArticleBlockType {
  id?: string;
  type: string;
  data: object;
}
export interface ArticleContentType {
  time?: number;
  blocks: ArticleBlockType[];
  version?: string;
}

export const author_type_enum = pgEnum("author_type", ["member", "guest"]);

// guests have name only
export const Author = pgTable(
  "author",
  {
    id: serial("id").primaryKey(),
    author_type: author_type_enum("author_type").notNull(),
    first_name: varchar("first_name", { length: 255 }).notNull(),
    last_name: varchar("last_name", { length: 255 }).notNull(),
    google_id: varchar("google_id", { length: 255 }),
    email: text("email"),
    image: varchar("image", { length: 255 }),
    user_id: varchar("user_id", { length: 255 }).references(() => users.id),
  },
  (author) => ({
    // The upsert target for sync_members: one Author row per Google member.
    // Guests keep a NULL google_id, and Postgres unique indexes allow any
    // number of NULLs, so this doesn't constrain them.
    google_id_unique: uniqueIndex("author_google_id_idx").on(author.google_id),
  }),
);

// --- better-auth tables (#32) ---
// The JS property names below are better-auth's own field names: the Drizzle
// adapter indexes the table object by them (`schemaModel[fieldName]`), so they
// must not be renamed. The DB column strings stay snake_case, matching the rest
// of this schema. `users.id` is the FK target of `Article.created_by` and
// `Media.user_id`, so its values are preserved across the migration.

export const users = pgTable("user", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  // Not our own claim about the address — better-auth reads this when deciding
  // whether an incoming Google sign-in links to this row. See #32.
  emailVerified: boolean("email_verified").notNull().default(false),
  image: varchar("image", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => new Date())
    .notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}));

export const accounts = pgTable(
  "account",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 255 }).notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (account) => ({
    userIdIdx: index("account_user_id_idx").on(account.userId),
  }),
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = pgTable(
  "session",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 255 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (session) => ({
    userIdIdx: index("session_user_id_idx").on(session.userId),
  }),
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verification = pgTable("verification", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  identifier: varchar("identifier", { length: 255 }).notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => new Date())
    .notNull(),
});

// --- Unified articles/media schema (#17) ---

export const article_status_enum = pgEnum("article_status", [
  "draft",
  "published",
  "archived",
  "deleted",
]);

// "content" rows are the 5 fixed club pages (history, rules, research,
// publishing, protection) migrated from hand-written MDX, going through the
// same draft/publish pipeline as news but at a fixed route instead of
// /novica/<slug> and without a slug that ever needs to move (#33).
export const article_kind_enum = pgEnum("article_kind", ["article", "content"]);
export type ArticleKind = (typeof article_kind_enum.enumValues)[number];

export interface MediaOriginalData {
  url: string;
  width: number;
  height: number;
  size_bytes: number;
}

export interface MediaVariantData {
  format: "avif" | "jpeg";
  width: number;
  height: number;
  url: string;
  size_bytes: number;
}

export interface MediaSrcsetsData {
  avif: string;
  jpeg: string;
  sizes: string;
}

export const Media = pgTable("media", {
  id: uuid("id").primaryKey(),
  filename: varchar("filename", { length: 255 }).notNull(),
  content_type: varchar("content_type", { length: 255 }).notNull(),
  size_bytes: integer("size_bytes").notNull(),
  original: jsonb("original").$type<MediaOriginalData>().notNull(),
  variants: jsonb("variants").$type<MediaVariantData[]>().notNull().default([]),
  srcsets: jsonb("srcsets").$type<MediaSrcsetsData>(),
  blur_placeholder: text("blur_placeholder"),
  // sha256 of the original file's bytes. Null means "not backfilled yet" —
  // set live by media ingest, which also uses it to reuse an existing row
  // instead of inserting a dupe. Rows created before that check existed may
  // still be null.
  hash: varchar("hash", { length: 64 }).unique(),
  created_at: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .$onUpdate(() => new Date())
    .notNull(),
});

export const Article = pgTable(
  "articles",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    legacy_id: integer("legacy_id").unique(),
    status: article_status_enum("status").notNull().default("draft"),
    article_kind: article_kind_enum("article_kind").notNull().default("article"),
    title: varchar("title", { length: 255 }).notNull(),
    content_json: jsonb("content_json").$type<ArticleContentType>(),
    thumbnail_media_id: uuid("thumbnail_media_id").references(() => Media.id),
    thumbnail_x: real("thumbnail_x"),
    thumbnail_y: real("thumbnail_y"),
    thumbnail_width: real("thumbnail_width"),
    thumbnail_height: real("thumbnail_height"),
    // Null means "unknown" (never backfilled and never resaved since) rather
    // than "not custom" — distinct from `false`, so a legacy row nobody has
    // touched yet doesn't silently masquerade as a known answer.
    uploaded_custom_thumbnail: boolean("uploaded_custom_thumbnail"),
    supersedes_id: uuid("supersedes_id").references((): AnyPgColumn => Article.id),
    created_by: varchar("created_by", { length: 255 }).references(() => users.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
    published_at: timestamp("published_at", { withTimezone: true }),
    archived_at: timestamp("archived_at", { withTimezone: true }),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    published_year: integer("published_year").generatedAlwaysAs(
      () => sql`EXTRACT(YEAR FROM (published_at AT TIME ZONE 'UTC'))`,
    ),
  },
  (articles) => ({
    status_published_year_idx: index("articles_status_published_year_idx").on(
      articles.status,
      articles.published_year,
    ),
    /** Feed order and the card date rely on this; drafts are the only undated rows. */
    published_has_date: check(
      "published_has_date",
      sql`${articles.status} <> 'published' OR ${articles.published_at} IS NOT NULL`,
    ),
  }),
);

export const ArticleRelations = relations(Article, ({ one, many }) => ({
  thumbnail_media: one(Media, {
    fields: [Article.thumbnail_media_id],
    references: [Media.id],
  }),
  supersedes: one(Article, {
    fields: [Article.supersedes_id],
    references: [Article.id],
    relationName: "supersedes",
  }),
  created_by_user: one(users, {
    fields: [Article.created_by],
    references: [users.id],
  }),
  articles_to_authors: many(ArticlesToAuthors),
  article_slugs: many(ArticleSlug),
  media_to_articles: many(MediaToArticles),
}));

export const ArticleSlug = pgTable(
  "article_slugs",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    article_id: uuid("article_id")
      .notNull()
      .references(() => Article.id, { onDelete: "cascade" }),
    is_primary: boolean("is_primary").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (article_slugs) => ({
    article_id_idx: index("article_slugs_article_id_idx").on(article_slugs.article_id),
  }),
);

export const ArticleSlugRelations = relations(ArticleSlug, ({ one }) => ({
  article: one(Article, {
    fields: [ArticleSlug.article_id],
    references: [Article.id],
  }),
}));

export const MediaToArticles = pgTable(
  "media_to_articles",
  {
    article_id: uuid("article_id")
      .notNull()
      .references(() => Article.id, { onDelete: "cascade" }),
    media_id: uuid("media_id")
      .notNull()
      .references(() => Media.id, { onDelete: "cascade" }),
    order: integer("order").default(0).notNull(),
  },
  (media_to_articles) => ({
    compoundKey: primaryKey({
      columns: [media_to_articles.article_id, media_to_articles.media_id],
    }),
  }),
);

export const MediaToArticlesRelations = relations(MediaToArticles, ({ one }) => ({
  article: one(Article, {
    fields: [MediaToArticles.article_id],
    references: [Article.id],
  }),
  media: one(Media, {
    fields: [MediaToArticles.media_id],
    references: [Media.id],
  }),
}));

export const MediaRelations = relations(Media, ({ many }) => ({
  media_to_articles: many(MediaToArticles),
}));

export const ArticlesToAuthors = pgTable(
  "articles_to_authors",
  {
    article_id: uuid("article_id")
      .notNull()
      .references(() => Article.id, { onDelete: "cascade" }),
    author_id: integer("author_id")
      .notNull()
      .references(() => Author.id, { onDelete: "cascade" }),
    order: integer("order").default(0).notNull(),
  },
  (articles_to_authors) => ({
    compoundKey: primaryKey({
      columns: [articles_to_authors.article_id, articles_to_authors.author_id],
    }),
  }),
);

export const ArticlesToAuthorsRelations = relations(ArticlesToAuthors, ({ one }) => ({
  article: one(Article, {
    fields: [ArticlesToAuthors.article_id],
    references: [Article.id],
  }),
  author: one(Author, {
    fields: [ArticlesToAuthors.author_id],
    references: [Author.id],
  }),
}));
