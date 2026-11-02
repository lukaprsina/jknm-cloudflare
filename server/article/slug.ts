import { and, eq, ne } from "drizzle-orm";
import { title_to_slug } from "../../lib/title-to-slug";
import type { DbTransaction } from "../db";
import { Article, ArticleSlug } from "../db/schema";
import { one, soft_delete_article } from "./article-rows";
import { assert_can_supersede, decide_slug_transition } from "./lifecycle-rules";

const MAX_SLUG_SUFFIX = 99;

/**
 * Claims `base` (or the first free `base-2`, `base-3`, ...) as `article_id`'s
 * primary slug and returns the row. A candidate is not a collision when it:
 *
 * - already belongs to `article_id` (a demoted slug from an earlier retitle
 *   being reverted): it is promoted instead of burning a suffix;
 * - belongs to a `deleted` article, which 404s unconditionally, so its slug is
 *   an unreachable dead end that is better reassigned than skipped.
 *
 * A candidate owned by a different live article is a real collision.
 */
async function assign_primary_slug(tx: DbTransaction, article_id: string, base: string) {
  for (let suffix = 1; suffix <= MAX_SLUG_SUFFIX; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const existing = await tx.query.ArticleSlug.findFirst({
      where: eq(ArticleSlug.slug, candidate),
      with: { article: { columns: { status: true } } },
    });

    if (!existing) return insert_primary_slug(tx, article_id, candidate);
    if (existing.article_id !== article_id && existing.article.status !== "deleted") continue;

    return one(
      await tx
        .update(ArticleSlug)
        .set({ article_id, is_primary: true })
        .where(eq(ArticleSlug.id, existing.id))
        .returning(),
    );
  }

  return insert_primary_slug(tx, article_id, `${base}-${Date.now()}`);
}

async function insert_primary_slug(tx: DbTransaction, article_id: string, slug: string) {
  return one(
    await tx.insert(ArticleSlug).values({ slug, article_id, is_primary: true }).returning(),
  );
}

export async function resolve_first_publish_slug(
  tx: DbTransaction,
  article_id: string,
  title: string,
) {
  const existing_primary = await tx.query.ArticleSlug.findFirst({
    where: and(eq(ArticleSlug.article_id, article_id), eq(ArticleSlug.is_primary, true)),
  });
  if (existing_primary) return existing_primary;

  return assign_primary_slug(tx, article_id, title_to_slug(title));
}

/**
 * Supersede-publish's slug rule: an unchanged title re-points the source's
 * primary slug to the newly published row; a changed one mints a new primary
 * and demotes the old, which follows the content so it keeps resolving. Every
 * other slug the lineage collected moves forward too. Retires the source.
 *
 * A `content`-kind source is always treated as unchanged: its route is a fixed
 * page, so its slug must never move.
 *
 * `legacy_id` moves separately (`inherit_identity_from_source`), because it
 * must also happen on the unarchive path, which never reaches this function.
 */
export async function resolve_supersede_publish_slug(
  tx: DbTransaction,
  article_id: string,
  supersedes_id: string,
  new_title: string,
) {
  // Lock the source so two concurrent supersede-publishes of it serialize: the
  // second blocks here, then sees `deleted` and fails `assert_can_supersede`
  // instead of overwriting the winner's slug re-point.
  const [source] = await tx
    .select({ title: Article.title, status: Article.status, article_kind: Article.article_kind })
    .from(Article)
    .where(eq(Article.id, supersedes_id))
    .for("update");
  if (!source) throw new Error("Superseded article not found");
  assert_can_supersede(source.status);

  const old_primary_slug =
    (await tx.query.ArticleSlug.findFirst({
      where: and(eq(ArticleSlug.article_id, supersedes_id), eq(ArticleSlug.is_primary, true)),
    })) ?? null;

  const decision = decide_slug_transition({
    old_title: source.title,
    new_title: source.article_kind === "content" ? source.title : new_title,
    old_primary_slug,
  });

  let primary: typeof ArticleSlug.$inferSelect;
  if (decision.action === "reuse") {
    primary = one(
      await tx
        .update(ArticleSlug)
        .set({ article_id })
        .where(eq(ArticleSlug.id, decision.slug_id))
        .returning(),
    );
  } else {
    if (decision.action === "mint_new_and_demote") {
      await tx
        .update(ArticleSlug)
        .set({ is_primary: false, article_id })
        .where(eq(ArticleSlug.id, decision.demote_slug_id));
    }
    primary = await assign_primary_slug(tx, article_id, title_to_slug(new_title));
  }

  await tx
    .update(ArticleSlug)
    .set({ is_primary: false, article_id })
    .where(and(eq(ArticleSlug.article_id, supersedes_id), ne(ArticleSlug.id, primary.id)));

  await soft_delete_article(tx, supersedes_id);
  return primary;
}

/**
 * Moves `legacy_id` off the source and onto the new row. It is how an inbound
 * link from the old site finds the article, so it must follow the content
 * forward; left on a retired row every such link would resolve to nothing.
 * Runs on the unarchive path too, where the source is already `deleted`.
 */
export async function inherit_identity_from_source(
  tx: DbTransaction,
  article_id: string,
  supersedes_id: string,
) {
  const [source] = await tx
    .select({ legacy_id: Article.legacy_id })
    .from(Article)
    .where(eq(Article.id, supersedes_id))
    .for("update");
  if (source?.legacy_id == null) return;

  // Unique column: the source releases the value before the new row takes it.
  await tx.update(Article).set({ legacy_id: null }).where(eq(Article.id, supersedes_id));
  await tx.update(Article).set({ legacy_id: source.legacy_id }).where(eq(Article.id, article_id));
}

/**
 * A plain save's counterpart to the supersede-publish retitle rule: a
 * published article's title changed under it, so mint a fresh primary slug and
 * demote the old one (kept, resolvable) rather than leave the primary slug
 * pointing at text that no longer matches the title.
 */
export async function resolve_retitle_slug(
  tx: DbTransaction,
  article_id: string,
  old_title: string,
  new_title: string,
) {
  const old_primary_slug =
    (await tx.query.ArticleSlug.findFirst({
      where: and(eq(ArticleSlug.article_id, article_id), eq(ArticleSlug.is_primary, true)),
    })) ?? null;

  const decision = decide_slug_transition({ old_title, new_title, old_primary_slug });
  if (decision.action === "reuse") return;

  if (decision.action === "mint_new_and_demote") {
    await tx
      .update(ArticleSlug)
      .set({ is_primary: false })
      .where(eq(ArticleSlug.id, decision.demote_slug_id));
  }
  await assign_primary_slug(tx, article_id, title_to_slug(new_title));
}
