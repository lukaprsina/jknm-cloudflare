import type { Article } from "../db/schema";

export type ArticleStatus = (typeof Article.$inferSelect)["status"];

/**
 * Pure status-transition guards and publish decisions. No DB or network, so the
 * rules are testable without a database; `create_articles` consults them
 * before touching rows.
 */

export function assert_can_archive(status: ArticleStatus) {
  if (status !== "draft" && status !== "published") {
    throw new Error(`Cannot archive an article with status "${status}"`);
  }
}

export function assert_can_delete(status: ArticleStatus) {
  if (status === "deleted") throw new Error("Article is already deleted");
}

/**
 * Discard is "cancel this edit, leave the source untouched", so it only makes
 * sense for a superseding draft. A standalone draft has no source to fall back
 * to and must be deleted instead.
 */
export function assert_can_discard(article: {
  status: ArticleStatus;
  supersedes_id: string | null;
}) {
  if (article.status !== "draft") {
    throw new Error(`Cannot discard an article with status "${article.status}"`);
  }
  if (!article.supersedes_id) {
    throw new Error("Only a superseding draft can be discarded; delete a standalone draft");
  }
}

export interface LifecycleRow {
  id: string;
  status: ArticleStatus;
  supersedes_id: string | null;
}

/**
 * Archive and delete on a superseding draft act on the article it supersedes,
 * and the now-moot draft is cascade-deleted. A draft whose source is already
 * `deleted` (unarchiving retires the archived source immediately) is standalone
 * in all but name: there is no live source left to retarget onto.
 */
export function resolve_lifecycle_target(
  article: LifecycleRow,
  source: LifecycleRow | null,
): { target: LifecycleRow; cascade_delete_draft_id: string | null } {
  if (!article.supersedes_id) return { target: article, cascade_delete_draft_id: null };
  if (!source) throw new Error("Source article not found");
  if (source.status === "deleted") return { target: article, cascade_delete_draft_id: null };
  return { target: source, cascade_delete_draft_id: article.id };
}

/** Guards spawning a superseding draft (unarchive, or revise while live). */
export function assert_can_supersede(status: ArticleStatus) {
  if (status !== "archived" && status !== "published") {
    throw new Error(`Cannot create a superseding draft from an article with status "${status}"`);
  }
}

/**
 * Whether publishing a draft with a `supersedes_id` retires its source and
 * inherits its identity, or is a standalone first publish. The source may
 * already be `deleted` (unarchiving retires it immediately); that case must
 * agree with `resolve_lifecycle_target` and fall back to first publish.
 */
export function is_supersede_publish(source: { status: ArticleStatus } | null): boolean {
  return source !== null && (source.status === "archived" || source.status === "published");
}

/**
 * True exactly when the source is `deleted`: while the draft is open, only
 * unarchiving can have retired it. Discarding without restoring would turn
 * "cancel this edit" into "delete the article".
 */
export function should_restore_source_on_discard(
  source: { status: ArticleStatus } | null,
): boolean {
  return source?.status === "deleted";
}

/**
 * The `published_at` a publish ends up with. An explicit pick wins (correcting
 * a revision's date is what the date picker is for). Otherwise a revision keeps
 * the source's original date: revising is not republishing. Keyed on "a source
 * exists", not on `is_supersede_publish`, because the unarchive path retires
 * its source at draft creation yet is still the same article.
 */
export function decide_published_at({
  requested,
  source,
  existing,
  now,
}: {
  requested?: Date | null;
  source: { published_at: Date | null } | null;
  existing: { published_at: Date | null };
  now: Date;
}): Date {
  return requested ?? source?.published_at ?? existing.published_at ?? now;
}

export type SlugTransitionDecision =
  | { action: "reuse"; slug_id: number }
  | { action: "mint_new_and_demote"; demote_slug_id: number }
  | { action: "mint_new" };

/**
 * Supersede-publish's slug rule: an unchanged title inherits the old primary
 * slug; a changed one mints a new primary and demotes the old (kept, still
 * resolvable).
 */
export function decide_slug_transition({
  old_title,
  new_title,
  old_primary_slug,
}: {
  old_title: string;
  new_title: string;
  old_primary_slug: { id: number } | null;
}): SlugTransitionDecision {
  if (!old_primary_slug) return { action: "mint_new" };
  if (old_title === new_title) return { action: "reuse", slug_id: old_primary_slug.id };
  return { action: "mint_new_and_demote", demote_slug_id: old_primary_slug.id };
}
