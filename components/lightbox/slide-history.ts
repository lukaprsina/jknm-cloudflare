import { useEffect, useRef } from "react";

/**
 * The lightbox owns one history entry on the article's own URL (`#slika-N`), so the back button
 * (Android's especially) closes it instead of leaving the article. Open pushes it, swiping
 * replaces it, closing pops it with history.back(), and Forward reopens it.
 */
const PREFIX = "#slika-";

/**
 * Pushes the entry; call when the lightbox opens from a click. The entry records the scroll
 * position in vinext's own keys: on Forward, vinext restores the entry's saved position, and
 * without one it scrolls to the missing `#slika-N` target, i.e. the top (smoothly, as `html` is).
 */
export function push_slide_entry(index: number) {
  const scroll = { __vinext_scrollX: scrollX, __vinext_scrollY: scrollY };
  history.pushState({ ...history.state, ...scroll }, "", PREFIX + (index + 1));
}

function index_in_hash(count: number): number | null {
  if (!location.hash.startsWith(PREFIX)) return null;
  const index = Number(location.hash.slice(PREFIX.length)) - 1;
  return Number.isInteger(index) && index >= 0 && index < count ? index : null;
}

/** While closed, Forward onto a `#slika-N` entry reopens the lightbox there. */
export function useReopenOnForward(is_open: boolean, count: number, open_at: (i: number) => void) {
  const latest = useRef({ is_open, count, open_at });
  useEffect(() => {
    latest.current = { is_open, count, open_at };
  });
  useEffect(() => {
    const on_popstate = () => {
      const { is_open, count, open_at } = latest.current;
      const index = is_open ? null : index_in_hash(count);
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
    history.replaceState(history.state, "", PREFIX + (active + 1));
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
