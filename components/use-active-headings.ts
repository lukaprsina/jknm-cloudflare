"use client";

import { useEffect, useState } from "react";

/**
 * The id of the heading the reader is in: the last one whose top has passed
 * the anchor offset (the same `scroll-margin-top` the headings are given), or
 * the first heading before any has.
 */
export function use_active_headings(ids: string[]) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const elements = ids.flatMap((id) => document.getElementById(id) ?? []);
    if (elements.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const visible = elements.filter((element) => element.getClientRects().length > 0);
      const offset = Number.parseFloat(getComputedStyle(elements[0]).scrollMarginTop) || 0;
      const current = visible.findLast(
        (element) => element.getBoundingClientRect().top <= offset + 1,
      );
      setActive((current ?? visible[0] ?? elements[0]).id);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };

    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
    };
  }, [ids]);

  return active;
}
