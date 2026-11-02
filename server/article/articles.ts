import { and, eq } from "drizzle-orm";
import type { Db, DbTransaction } from "../db";
import { Article, ArticlesToAuthors, type ArticleContentType } from "../db/schema";
import { resilient, type Emit } from "../events";
import type { DomainEvent } from "../../lib/cache-policy";
import {
  copied_columns,
  find_article_with_relations,
  find_source,
  found,
  one,
  resolve_thumbnail,
  soft_delete_article,
  type ThumbnailCrop,
} from "./article-rows";
import {
  assert_can_archive,
  assert_can_delete,
  assert_can_discard,
  assert_can_supersede,
  decide_published_at,
  is_supersede_publish,
  resolve_lifecycle_target,
  should_remint_slug_on_save,
  should_restore_source_on_discard,
} from "./lifecycle-rules";
import { reconcile_media_to_articles } from "./reconcile-media";
import {
  inherit_identity_from_source,
  resolve_first_publish_slug,
  resolve_retitle_slug,
  resolve_supersede_publish_slug,
} from "./slug";

export interface ArticleInput {
  title: string;
  content?: ArticleContentType | null;
  thumbnail_crop?: ThumbnailCrop;
  published_at?: Date;
}

async function replace_article_authors(
  tx: DbTransaction,
  article_id: string,
  author_ids: number[],
) {
  await tx.delete(ArticlesToAuthors).where(eq(ArticlesToAuthors.article_id, article_id));
  if (author_ids.length === 0) return;
  await tx
    .insert(ArticlesToAuthors)
    .values(author_ids.map((author_id, index) => ({ article_id, author_id, order: index })));
}

/**
 * The write `save` and `publish` share: the article's fields and thumbnail,
 * its authors, and its media links. `status_and_date` is what differs.
 */
async function write_article(
  tx: DbTransaction,
  article_id: string,
  { article, author_ids }: { article: ArticleInput; author_ids: number[] },
  status_and_date: { status?: "published"; published_at: Date },
) {
  const thumbnail = await resolve_thumbnail(tx, article.thumbnail_crop);
  const updated = one(
    await tx
      .update(Article)
      .set({
        title: article.title,
        content_json: article.content ?? undefined,
        ...status_and_date,
        ...thumbnail,
      })
      .where(eq(Article.id, article_id))
      .returning(),
  );

  await replace_article_authors(tx, article_id, author_ids);
  // Reconcile against the persisted content, not the input: an omitted
  // `content` leaves the stored one in place, and keying off the input would
  // wipe every link on a content-less save.
  await reconcile_media_to_articles(tx, article_id, updated.content_json);
  return updated;
}

const LIFECYCLE_COLUMNS = { id: true, status: true, supersedes_id: true } as const;

/**
 * The row an archive or delete really acts on: the article itself, unless it
 * is a superseding draft, in which case its source (see
 * `resolve_lifecycle_target`).
 */
async function find_lifecycle_target(tx: DbTransaction, article_id: string) {
  const existing = found(
    await tx.query.Article.findFirst({
      where: eq(Article.id, article_id),
      columns: LIFECYCLE_COLUMNS,
    }),
  );
  const source = await find_source(tx, existing.supersedes_id, LIFECYCLE_COLUMNS);
  return resolve_lifecycle_target(existing, source);
}

export function create_articles({ db, emit }: { db: Db; emit: Emit }) {
  const announce = resilient(emit);
  return {
    async create(input: { title: string }, actor_id: string) {
      const created = one(
        await db
          .insert(Article)
          .values({
            title: input.title,
            status: "draft",
            content_json: {
              blocks: [{ type: "header", data: { text: input.title, level: 1 } }],
            },
            created_by: actor_id,
          })
          .returning(),
      );
      await announce("article.created");
      return created;
    },

    /**
     * Saves a draft. `published_at` doubles as "the date this piece is or will
     * be published", so a picked date survives closing the editor. Omitted
     * content leaves the stored content alone.
     */
    async save(input: { article_id: string; article: ArticleInput; author_ids: number[] }) {
      const saved = await db.transaction(async (tx) => {
        const existing = found(
          await tx.query.Article.findFirst({
            where: eq(Article.id, input.article_id),
            columns: { title: true, status: true, article_kind: true, published_at: true },
          }),
        );

        await write_article(tx, input.article_id, input, {
          published_at: input.article.published_at ?? existing.published_at ?? new Date(),
        });

        if (
          should_remint_slug_on_save({
            ...existing,
            old_title: existing.title,
            new_title: input.article.title,
          })
        ) {
          await resolve_retitle_slug(tx, input.article_id, existing.title, input.article.title);
        }
        return find_article_with_relations(tx, eq(Article.id, input.article_id));
      });
      await announce("article.saved");
      return saved;
    },

    /**
     * Publishes a draft and gives it a public slug. A republish keeps its slug.
     * Publishing a revision of a live or archived article inherits the source's
     * slug (unless retitled), `published_at` and `legacy_id`, and retires the
     * source. A revision whose source was already retired by unarchiving takes
     * the first-publish path but still inherits date and `legacy_id`.
     */
    async publish(input: { article_id: string; article: ArticleInput; author_ids: number[] }) {
      const result = await db.transaction(async (tx) => {
        const existing = found(
          await tx.query.Article.findFirst({
            where: eq(Article.id, input.article_id),
            columns: { published_at: true, supersedes_id: true },
          }),
        );
        // A plain read to pick the path; the locking re-read inside
        // `resolve_supersede_publish_slug` is what guards the race.
        const source = await find_source(tx, existing.supersedes_id, {
          status: true,
          published_at: true,
        });

        await write_article(tx, input.article_id, input, {
          status: "published",
          published_at: decide_published_at({
            requested: input.article.published_at,
            source,
            existing,
            now: new Date(),
          }),
        });

        const slug_row =
          existing.supersedes_id && is_supersede_publish(source)
            ? await resolve_supersede_publish_slug(
                tx,
                input.article_id,
                existing.supersedes_id,
                input.article.title,
              )
            : await resolve_first_publish_slug(tx, input.article_id, input.article.title);

        if (existing.supersedes_id) {
          await inherit_identity_from_source(tx, input.article_id, existing.supersedes_id);
        }

        const article = found(
          await find_article_with_relations(tx, eq(Article.id, input.article_id)),
          "Published article",
        );
        return { article, slug: slug_row.slug };
      });
      await announce("article.published");
      return result;
    },

    /** `draft`/`published` -> `archived`. On a superseding draft, archives its source. */
    async archive(input: { article_id: string }) {
      const archived = await db.transaction(async (tx) => {
        const { target, cascade_delete_draft_id } = await find_lifecycle_target(
          tx,
          input.article_id,
        );
        assert_can_archive(target.status);

        await tx
          .update(Article)
          .set({ status: "archived", archived_at: new Date() })
          .where(eq(Article.id, target.id));

        if (cascade_delete_draft_id) await soft_delete_article(tx, cascade_delete_draft_id);
        return find_article_with_relations(tx, eq(Article.id, target.id));
      });
      await announce("article.archived");
      return archived;
    },

    /**
     * Any status but `deleted` -> `deleted`, which is terminal. On a superseding
     * draft this deletes the source too ("take the article down"); to cancel
     * just the revision, use `discard_draft`.
     */
    async delete(input: { article_id: string }) {
      const deleted = await db.transaction(async (tx) => {
        const { target, cascade_delete_draft_id } = await find_lifecycle_target(
          tx,
          input.article_id,
        );
        assert_can_delete(target.status);

        const deleted = await soft_delete_article(tx, target.id);
        if (cascade_delete_draft_id) await soft_delete_article(tx, cascade_delete_draft_id);
        return deleted;
      });
      await announce("article.deleted");
      return deleted;
    },

    /**
     * Cancels a revision without touching its source: soft-deletes just this
     * draft. If unarchiving already retired the source, it goes back to
     * `archived`, otherwise "cancel this edit" would delete the article.
     */
    async discard_draft(input: { article_id: string }) {
      const discarded = await db.transaction(async (tx) => {
        const existing = found(
          await tx.query.Article.findFirst({
            where: eq(Article.id, input.article_id),
            columns: LIFECYCLE_COLUMNS,
          }),
        );
        assert_can_discard(existing);
        const source = await find_source(tx, existing.supersedes_id, { status: true });

        if (existing.supersedes_id && should_restore_source_on_discard(source)) {
          await tx
            .update(Article)
            .set({ status: "archived", deleted_at: null })
            .where(eq(Article.id, existing.supersedes_id));
        }
        return soft_delete_article(tx, existing.id);
      });
      await announce("article.draft_discarded");
      return discarded;
    },

    /**
     * Spawns a draft superseding a `published` or `archived` article. A
     * published source stays live and visible until the draft is published; an
     * archived one is retired immediately, since there is no visibility to
     * protect and leaving it in the archive beside an identical draft would be
     * confusing. Asking again while a draft is open returns that draft.
     */
    async create_superseding_draft(input: { article_id: string }, actor_id: string) {
      const { draft_id, event } = await db.transaction(async (tx) => {
        const source = found(
          await find_article_with_relations(tx, eq(Article.id, input.article_id)),
        );
        assert_can_supersede(source.status);

        const open_draft = await tx.query.Article.findFirst({
          where: and(eq(Article.supersedes_id, source.id), eq(Article.status, "draft")),
          columns: { id: true },
        });
        if (open_draft) return { draft_id: open_draft.id, event: null };

        const draft = one(
          await tx
            .insert(Article)
            .values({
              ...copied_columns(source),
              status: "draft",
              supersedes_id: source.id,
              created_by: actor_id,
            })
            .returning(),
        );

        if (source.articles_to_authors.length > 0) {
          await tx.insert(ArticlesToAuthors).values(
            source.articles_to_authors.map((rel) => ({
              article_id: draft.id,
              author_id: rel.author_id,
              order: rel.order,
            })),
          );
        }
        await reconcile_media_to_articles(tx, draft.id, draft.content_json);
        if (source.status === "archived") await soft_delete_article(tx, source.id);

        // One action, two events: an archived source was just retired (the
        // archive listing changed), a published one stays live and untouched.
        const event: DomainEvent =
          source.status === "archived" ? "article.unarchived" : "article.superseding_draft_created";
        return { draft_id: draft.id, event };
      });

      if (event) await announce(event);
      return found(await find_article_with_relations(db, eq(Article.id, draft_id)), "Draft");
    },
  };
}
