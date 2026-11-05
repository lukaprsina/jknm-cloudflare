import { useEffect, useRef } from "react";
import { lightbox_index, replace_lightbox_entry } from "../history-state";

/** While closed, Forward onto a lightbox entry reopens the lightbox there. */
export function useReopenOnForward(is_open: boolean, count: number, open_at: (i: number) => void) {
  const latest = useRef({ is_open, count, open_at });
  useEffect(() => {
    latest.current = { is_open, count, open_at };
  });
  useEffect(() => {
    const on_popstate = () => {
      const { is_open, count, open_at } = latest.current;
      const index = is_open ? null : lightbox_index(count);
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
    replace_lightbox_entry(active);
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
