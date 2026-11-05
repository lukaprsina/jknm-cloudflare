import { useEffect, useRef } from "react";

/**
 * The lightbox owns one history entry on the article's own URL, marked by `{ lightbox: index }`
 * in its state, so the back button (Android's especially) closes it instead of leaving the
 * article. Open pushes it, swiping replaces it, closing pops it with history.back(), and Forward
 * reopens it.
 *
 * The entry has no hash and no saved scroll position: the lightbox is an overlay, so moving
 * through its entries must never scroll the page (vinext restores a position only when the entry
 * carries one, or a hash target).
 */
export function push_slide_entry(index: number) {
  history.pushState({ lightbox: index }, "");
}

function index_in_state(count: number): number | null {
  const index = history.state?.lightbox;
  return Number.isInteger(index) && index >= 0 && index < count ? index : null;
}

/**
 * Stops the browser from restoring a scroll position when traversing history, for as long as the
 * article is mounted. Its automatic restoration puts the page back where the lightbox entry was
 * recorded, on Forward and again on close. vinext still restores pages
 * it navigated through, as those entries carry their own saved position.
 */
export function useManualScrollRestoration() {
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);
}

/** While closed, Forward onto a lightbox entry reopens the lightbox there. */
export function useReopenOnForward(is_open: boolean, count: number, open_at: (i: number) => void) {
  const latest = useRef({ is_open, count, open_at });
  useEffect(() => {
    latest.current = { is_open, count, open_at };
  });
  useEffect(() => {
    const on_popstate = () => {
      const { is_open, count, open_at } = latest.current;
      const index = is_open ? null : index_in_state(count);
      if (index !== null) open_at(index);
    };
    window.addEventListener("popstate", on_popstate);
    return () => window.removeEventListener("popstate", on_popstate);
  }, []);
}

/**
 * The open lightbox's side: keeps the entry on the current slide, and returns `close`, which
 * starts the fade at once and pops the entry exactly once however many closes arrive
 * (Escape, X, backdrop, swipe) before popstate lands. Browser back closes through the same path.
 */
export function useSlideEntry(active: number, set_open: (open: boolean) => void) {
  const closing = useRef(false);
  useEffect(() => {
    history.replaceState({ lightbox: active }, "");
  }, [active]);
  useEffect(() => {
    const on_popstate = () => {
      closing.current = true;
      set_open(false);
    };
    window.addEventListener("popstate", on_popstate);
    return () => window.removeEventListener("popstate", on_popstate);
  }, [set_open]);
  return () => {
    if (closing.current) return;
    closing.current = true;
    set_open(false);
    history.back();
  };
}
