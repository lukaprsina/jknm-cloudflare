import { describe, expect, test } from "vite-plus/test";
import type { FeedCard, FeedCursor } from "@/server/published/create-published";
import { append_page, create_feed_memory, type FeedState } from "./feed-state";

function card(id: string): FeedCard {
  return {
    id,
    slug: id,
    title: id,
    excerpt: "",
    published_at: "2024-01-01T00:00:00.000Z",
    authors: [],
    thumbnail: null,
  };
}

const cursor = (id: string): FeedCursor => ({ id }) as unknown as FeedCursor;

describe("append_page", () => {
  test("adds the page after the shown cards and moves on to the page's cursor", () => {
    const shown: FeedState = { cards: [card("a"), card("b")], next_cursor: cursor("b") };
    const next = append_page(shown, { cards: [card("c")], next_cursor: cursor("c") });
    expect(next.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(next.next_cursor).toEqual(cursor("c"));
  });

  test("drops a card the visitor already has: a publish between two pages can repeat one", () => {
    const shown: FeedState = { cards: [card("a"), card("b")], next_cursor: cursor("b") };
    const next = append_page(shown, { cards: [card("b"), card("c")], next_cursor: null });
    expect(next.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  test("the last page ends the feed", () => {
    const shown: FeedState = { cards: [card("a")], next_cursor: cursor("a") };
    expect(append_page(shown, { cards: [], next_cursor: null }).next_cursor).toBeNull();
  });
});

describe("create_feed_memory", () => {
  const grown = (id: string): FeedState => ({ cards: [card(id)], next_cursor: null });

  function memory(max = 3) {
    const at = { entry: 1 as number | null };
    return { at, memory: create_feed_memory({ read_entry: () => at.entry, max }) };
  }

  test("recalls the list remembered for the same history entry", () => {
    const { memory: m } = memory();
    m.remember(1, grown("a"));
    expect(m.recall()).toEqual(grown("a"));
  });

  test("a different entry, such as one the logo just pushed, recalls nothing", () => {
    const { at, memory: m } = memory();
    m.remember(1, grown("a"));
    at.entry = 2;
    expect(m.recall()).toBeNull();
  });

  test("with no entry number there is nothing to recall or remember", () => {
    const { at, memory: m } = memory();
    at.entry = null;
    m.remember(null, grown("a"));
    expect(m.recall()).toBeNull();
  });

  test("keeps the most recent entries only", () => {
    const { at, memory: m } = memory(2);
    for (const entry of [1, 2, 3]) m.remember(entry, grown(String(entry)));
    at.entry = 1;
    expect(m.recall()).toBeNull();
    at.entry = 3;
    expect(m.recall()).toEqual(grown("3"));
  });

  test("remembering an entry again makes it the most recent", () => {
    const { at, memory: m } = memory(2);
    m.remember(1, grown("1"));
    m.remember(2, grown("2"));
    m.remember(1, grown("1b"));
    m.remember(3, grown("3"));
    at.entry = 1;
    expect(m.recall()).toEqual(grown("1b"));
    at.entry = 2;
    expect(m.recall()).toBeNull();
  });
});
