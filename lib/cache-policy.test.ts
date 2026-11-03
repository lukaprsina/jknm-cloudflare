import { describe, expect, test } from "vite-plus/test";
import { CACHE_TAGS, DOMAIN_EVENTS, invalidations_for } from "./cache-policy";

describe("invalidations_for", () => {
  test.each([
    "article.published",
    "article.live_saved",
    "article.archived",
    "article.deleted",
  ] as const)("%s changes the published set", (event) => {
    const { tags, paths } = invalidations_for(event);
    expect([...tags].sort()).toEqual(
      ["all-published", "archive", "article", "drafts", "homepage-feed"].sort(),
    );
    expect(paths).toEqual(["/", "/sitemap.xml"]);
  });

  test.each([
    "article.created",
    "article.saved",
    "article.draft_discarded",
    "article.superseding_draft_created",
  ] as const)("%s only touches drafts", (event) => {
    expect(invalidations_for(event).tags).toEqual(["drafts"]);
  });

  test("article.unarchived refreshes archive and preveri but not the homepage feed", () => {
    const { tags } = invalidations_for("article.unarchived");
    expect([...tags].sort()).toEqual(["all-published", "archive", "drafts"]);
  });

  test.each(["author.inserted", "author.renamed", "author.deleted", "author.synced"] as const)(
    "%s refreshes authors and every byline",
    (event) => {
      expect([...invalidations_for(event).tags].sort()).toEqual(["article", "authors"]);
    },
  );
});

describe("cache tag reachability", () => {
  // `homepage-feed` and `all-published` once sat declared at their cache sites
  // with no event reaching them, serving frozen data. A declared tag no event
  // invalidates must fail the suite.
  test.each(CACHE_TAGS)("%s is invalidated by at least one event", (tag) => {
    const reaching = DOMAIN_EVENTS.filter((event) => invalidations_for(event).tags.includes(tag));
    expect(reaching).not.toHaveLength(0);
  });
});
