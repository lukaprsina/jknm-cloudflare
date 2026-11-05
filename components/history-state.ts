/** The parts of `window.history` this file touches; tests pass a fake. */
export type HistoryLike = Pick<History, "state" | "pushState" | "replaceState">;

/**
 * Everything the site reads from or writes to `history.state`, in one place. vinext also keeps
 * its own keys in that object and carries them over onto entries written through `pushState` and
 * `replaceState`, so a state set here never has to repeat them.
 */

/**
 * vinext's number for the current history entry. Each page it navigates to gets a number higher
 * than any before it (until a reload), so the number identifies the entry. There is no public
 * key for it; `null` when the entry has none.
 */
export function history_entry(history: HistoryLike = window.history): number | null {
  const index: unknown = history.state?.__vinext_historyIndex;
  return typeof index === "number" ? index : null;
}

/** What a lightbox entry's state holds: the slide it shows. */
interface LightboxState {
  lightbox: number;
}

/** Opening the lightbox adds an entry on the article's own URL, so Back closes it. */
export function push_lightbox_entry(index: number, history: HistoryLike = window.history) {
  const state: LightboxState = { lightbox: index };
  history.pushState(state, "");
}

/** Swiping to another slide keeps the one entry. */
export function replace_lightbox_entry(index: number, history: HistoryLike = window.history) {
  const state: LightboxState = { lightbox: index };
  history.replaceState(state, "");
}

/** The slide a lightbox entry shows, if the current entry is one for an article with `count` images. */
export function lightbox_index(
  count: number,
  history: HistoryLike = window.history,
): number | null {
  const index: unknown = history.state?.lightbox;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < count
    ? index
    : null;
}
