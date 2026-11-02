/**
 * The single source of truth for what a mutation invalidates.
 *
 * Deciding *what* to invalidate is a pure function returning a value; actually
 * invalidating is a thin adapter (`server/cache-invalidation.ts`) that holds no
 * rules. Mutations emit a `DomainEvent`; they never name tags or paths.
 */

/**
 * Every cache tag declared at a cache site. Declare a tag at a site as
 * `satisfies CacheTag[]`: an unlisted tag fails typecheck, and a listed tag no
 * event reaches fails the reachability test.
 */
export const CACHE_TAGS = [
  "drafts",
  "archive",
  "authors",
  "homepage-feed",
  "all-published",
  "article",
] as const;

export type CacheTag = (typeof CACHE_TAGS)[number];

/**
 * What happened, in the vocabulary of `GLOSSARY.md`. One action can emit one of
 * several events: unarchiving retires the archived source (`article.unarchived`),
 * while a revision of a published article leaves it live
 * (`article.superseding_draft_created`).
 */
export const DOMAIN_EVENTS = [
  "article.created",
  "article.saved",
  "article.live_saved",
  "article.published",
  "article.archived",
  "article.unarchived",
  "article.deleted",
  "article.draft_discarded",
  "article.superseding_draft_created",
  "author.inserted",
  "author.renamed",
  "author.deleted",
  "author.synced",
] as const;

export type DomainEvent = (typeof DOMAIN_EVENTS)[number];

export interface Invalidations {
  readonly tags: readonly CacheTag[];
  readonly paths: readonly string[];
}

/** Every article view is reachable from `/`, and published-set changes change the sitemap. */
const PATHS = ["/", "/sitemap.xml"] as const;

const PUBLISHED_SET_CHANGED: Invalidations = {
  tags: ["drafts", "archive", "homepage-feed", "all-published", "article"],
  paths: PATHS,
};

const DRAFTS_ONLY: Invalidations = { tags: ["drafts"], paths: PATHS };

// `article` is included because an article page embeds its authors' names for
// the byline; renaming or deleting an author would otherwise leave stale bylines.
const AUTHORS_CHANGED: Invalidations = { tags: ["authors", "article"], paths: PATHS };

const INVALIDATIONS: Record<DomainEvent, Invalidations> = {
  "article.created": DRAFTS_ONLY,
  "article.saved": DRAFTS_ONLY,
  "article.draft_discarded": DRAFTS_ONLY,
  // The source stays live and untouched until the draft is published.
  "article.superseding_draft_created": DRAFTS_ONLY,
  // The archived source is retired as the draft is spawned: the archive listing
  // and `/preveri` (everything ever public, archived included) change. No public
  // page does: an archived article was already hidden and a hidden slug is never
  // cached, so the `article` tag is not needed. Nor is the homepage feed.
  "article.unarchived": { tags: ["drafts", "archive", "all-published"], paths: PATHS },
  // A plain save of a published article (a retitle mints a new primary slug)
  // changes what the public sees, unlike a draft save.
  "article.live_saved": PUBLISHED_SET_CHANGED,
  "article.published": PUBLISHED_SET_CHANGED,
  "article.archived": PUBLISHED_SET_CHANGED,
  "article.deleted": PUBLISHED_SET_CHANGED,
  "author.inserted": AUTHORS_CHANGED,
  "author.renamed": AUTHORS_CHANGED,
  "author.deleted": AUTHORS_CHANGED,
  "author.synced": AUTHORS_CHANGED,
};

export function invalidations_for(event: DomainEvent): Invalidations {
  return INVALIDATIONS[event];
}
