import { describe, expect, test } from "vite-plus/test";
import {
  assert_can_archive,
  assert_can_delete,
  assert_can_discard,
  assert_can_supersede,
  decide_published_at,
  decide_slug_transition,
  is_supersede_publish,
  resolve_lifecycle_target,
  should_restore_source_on_discard,
} from "./lifecycle-rules";

describe("which statuses a lifecycle action accepts", () => {
  test("archive accepts draft and published, nothing else", () => {
    expect(() => assert_can_archive("draft")).not.toThrow();
    expect(() => assert_can_archive("published")).not.toThrow();
    expect(() => assert_can_archive("archived")).toThrow(/archive/);
    expect(() => assert_can_archive("deleted")).toThrow(/archive/);
  });

  test("delete accepts everything except the terminal deleted status", () => {
    for (const status of ["draft", "published", "archived"] as const) {
      expect(() => assert_can_delete(status)).not.toThrow();
    }
    expect(() => assert_can_delete("deleted")).toThrow(/already deleted/);
  });

  test("only a superseding draft can be discarded", () => {
    expect(() => assert_can_discard({ status: "draft", supersedes_id: "src" })).not.toThrow();
    expect(() => assert_can_discard({ status: "draft", supersedes_id: null })).toThrow(
      /standalone draft/,
    );
    expect(() => assert_can_discard({ status: "published", supersedes_id: "src" })).toThrow(
      /discard/,
    );
  });
});

describe("resolve_lifecycle_target", () => {
  test("a standalone article is its own target", () => {
    const article = { id: "a", status: "published", supersedes_id: null } as const;
    expect(resolve_lifecycle_target(article, null)).toEqual({
      target: article,
      cascade_delete_draft_id: null,
    });
  });

  test("a superseding draft retargets its source and cascades its own deletion", () => {
    const draft = { id: "d", status: "draft", supersedes_id: "s" } as const;
    const source = { id: "s", status: "published", supersedes_id: null } as const;
    expect(resolve_lifecycle_target(draft, source)).toEqual({
      target: source,
      cascade_delete_draft_id: "d",
    });
  });

  test("a draft whose source was already retired by unarchiving is standalone", () => {
    const draft = { id: "d", status: "draft", supersedes_id: "s" } as const;
    const source = { id: "s", status: "deleted", supersedes_id: null } as const;
    expect(resolve_lifecycle_target(draft, source)).toEqual({
      target: draft,
      cascade_delete_draft_id: null,
    });
  });

  test("a missing source is an error, not a silent self-target", () => {
    const draft = { id: "d", status: "draft", supersedes_id: "s" } as const;
    expect(() => resolve_lifecycle_target(draft, null)).toThrow(/Source article not found/);
  });
});

describe("superseding", () => {
  test("only a live or archived article can be revised", () => {
    expect(() => assert_can_supersede("published")).not.toThrow();
    expect(() => assert_can_supersede("archived")).not.toThrow();
    expect(() => assert_can_supersede("draft")).toThrow(/superseding draft/);
    expect(() => assert_can_supersede("deleted")).toThrow(/superseding draft/);
  });

  test("publishing supersedes only a live or archived source; a retired one falls back to first publish", () => {
    expect(is_supersede_publish({ status: "published" })).toBe(true);
    expect(is_supersede_publish({ status: "archived" })).toBe(true);
    expect(is_supersede_publish({ status: "deleted" })).toBe(false);
    expect(is_supersede_publish({ status: "draft" })).toBe(false);
    expect(is_supersede_publish(null)).toBe(false);
  });

  test("discarding restores a source that unarchiving retired, and nothing else", () => {
    expect(should_restore_source_on_discard({ status: "deleted" })).toBe(true);
    expect(should_restore_source_on_discard({ status: "published" })).toBe(false);
    expect(should_restore_source_on_discard(null)).toBe(false);
  });
});

describe("decide_published_at", () => {
  const now = new Date("2026-11-02T00:00:00Z");
  const source_date = new Date("2020-01-01T00:00:00Z");
  const own_date = new Date("2024-06-01T00:00:00Z");
  const picked = new Date("2026-08-12T00:00:00Z");

  test("an explicit pick wins over everything", () => {
    expect(
      decide_published_at({
        requested: picked,
        source: { published_at: source_date },
        existing: { published_at: own_date },
        now,
      }),
    ).toEqual(picked);
  });

  test("a revision keeps the source's original date, even if the draft has its own", () => {
    expect(
      decide_published_at({
        source: { published_at: source_date },
        existing: { published_at: own_date },
        now,
      }),
    ).toEqual(source_date);
  });

  test("without a source, the draft's own date, then now", () => {
    expect(
      decide_published_at({ source: null, existing: { published_at: own_date }, now }),
    ).toEqual(own_date);
    expect(decide_published_at({ source: null, existing: { published_at: null }, now })).toEqual(
      now,
    );
  });

  test("a source that never had a date does not hide the draft's own", () => {
    expect(
      decide_published_at({
        requested: null,
        source: { published_at: null },
        existing: { published_at: own_date },
        now,
      }),
    ).toEqual(own_date);
  });
});

describe("decide_slug_transition", () => {
  test("an unchanged title inherits the old primary slug", () => {
    expect(
      decide_slug_transition({
        old_title: "Jama",
        new_title: "Jama",
        old_primary_slug: { id: 7 },
      }),
    ).toEqual({ action: "reuse", slug_id: 7 });
  });

  test("a changed title mints a new slug and demotes the old one", () => {
    expect(
      decide_slug_transition({
        old_title: "Jama",
        new_title: "Velika jama",
        old_primary_slug: { id: 7 },
      }),
    ).toEqual({ action: "mint_new_and_demote", demote_slug_id: 7 });
  });

  test("with no old primary slug a new one is minted, whatever the title", () => {
    for (const new_title of ["Jama", "Velika jama"]) {
      expect(
        decide_slug_transition({ old_title: "Jama", new_title, old_primary_slug: null }),
      ).toEqual({ action: "mint_new" });
    }
  });
});
