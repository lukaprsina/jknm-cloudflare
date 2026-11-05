// Everything the site reads from or writes to `history.state`, in one place. vinext also keeps
// its own keys in that object and carries them over onto entries written through `pushState` and
// `replaceState`, so a state written here never has to repeat them.

/** The parts of `window.history` this file touches; tests pass a fake. */
export type HistoryLike = Pick<History, "state" | "pushState" | "replaceState">;

/**
 * vinext's number for the current history entry. Each page it navigates to gets a number higher
 * than any before it (until a reload), so the number identifies the entry. There is no public
 * key for it; `null` when the entry has none. Also `null` on the server, which has no history.
 */
export function history_entry(history?: HistoryLike): number | null {
  const source = history ?? (typeof window === "undefined" ? undefined : window.history);
  const index: unknown = source?.state?.__vinext_historyIndex;
  return typeof index === "number" ? index : null;
}

/** What a lightbox entry's state holds: the slide it shows. */
interface LightboxState {
  lightbox: number;
}

function lightbox_state(index: number): LightboxState {
  return { lightbox: index };
}

/**
 * Opening the lightbox adds an entry on the article's own URL, so Back (Android's especially)
 * closes it instead of leaving the article.
 *
 * The entry has no hash and no saved scroll position: the lightbox is an overlay, so moving
 * through its entries must never scroll the page (vinext restores a position only when the entry
 * carries one, or a hash target).
 */
export function push_lightbox_entry(index: number, history: HistoryLike = window.history) {
  history.pushState(lightbox_state(index), "");
}

/** Swiping to another slide keeps the one entry. */
export function replace_lightbox_entry(index: number, history: HistoryLike = window.history) {
  history.replaceState(lightbox_state(index), "");
}

/** The slide a lightbox entry shows, if the current entry is one for an article with `count` images. */
export function lightbox_index(
  count: number,
  history: HistoryLike = window.history,
): number | null {
  const index: unknown = history.state?.lightbox;
  const valid = typeof index === "number" && Number.isInteger(index) && index >= 0 && index < count;
  return valid ? index : null;
}
