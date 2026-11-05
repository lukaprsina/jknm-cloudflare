import type { FeedPage } from "@/server/published/create-published";

/** What the homepage list shows and where its next page starts. */
export type FeedState = Pick<FeedPage, "cards" | "next_cursor">;

/**
 * The shown list plus a loaded page. A publish between two pages can repeat a card; ids are the
 * identity.
 */
export function append_page(shown: FeedState, page: FeedPage): FeedState {
  const ids = new Set(shown.cards.map((card) => card.id));
  return {
    cards: [...shown.cards, ...page.cards.filter((card) => !ids.has(card.id))],
    next_cursor: page.next_cursor,
  };
}

/**
 * The lists that grew past the first page, by history entry. Back to such an entry shows the list
 * the visitor had, at full height, so the scroll position can be restored. A new visit to `/`
 * (the logo) is a new entry, so it starts from fresh server data. Memory only: a reload starts
 * over too, which also keeps hydration matching the server's HTML. Only the `max` most recently
 * grown entries are kept.
 */
export function create_feed_memory({
  read_entry,
  max,
}: {
  /** The current history entry's number, or `null` when there is none. */
  read_entry: () => number | null;
  max: number;
}) {
  const grown = new Map<number, FeedState>();
  return {
    /** The list remembered for the current entry. */
    recall(): FeedState | null {
      const entry = read_entry();
      return entry === null ? null : (grown.get(entry) ?? null);
    },
    /** `entry` is read by the caller when the load started: the visitor may have moved on since. */
    remember(entry: number | null, feed: FeedState) {
      if (entry === null) return;
      grown.delete(entry);
      grown.set(entry, feed);
      for (const oldest of grown.keys()) {
        if (grown.size <= max) break;
        grown.delete(oldest);
      }
    },
  };
}
