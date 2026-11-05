import { useEffect } from "react";

/**
 * Stops the browser from restoring a scroll position when traversing history, for as long as the
 * caller is mounted. Its automatic restoration puts the page back where the lightbox entry was
 * recorded, on Forward and again on close. vinext still restores the pages it navigated through,
 * as those entries carry their own saved position.
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
