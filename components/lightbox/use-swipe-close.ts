import { useEffect, useRef } from "react";

/** Drag distance (px) past which letting go closes the lightbox. */
const CLOSE_DISTANCE = 100;
/** Vertical movement must beat horizontal by this factor, or Embla's slide change owns the gesture. */
const VERTICAL_BIAS = 1.5;
const START_SLOP = 10;

/**
 * Swipe down with one finger to close. The stage follows the finger and the backdrop fades.
 * Off while zoomed, where a drag pans, and for mouse input.
 */
export function useSwipeClose(
  stage: HTMLElement | null,
  fade: HTMLElement | null,
  blocked: () => boolean,
  on_close: () => void,
) {
  const latest = useRef({ blocked, on_close });
  useEffect(() => {
    latest.current = { blocked, on_close };
  });

  useEffect(() => {
    if (!stage || !fade) return;
    let start: { id: number; x: number; y: number } | null = null;
    let dragging = false;
    let distance = 0;

    const follow = (dy: number) => {
      stage.style.transform = `translateY(${dy}px)`;
      fade.style.opacity = String(Math.max(0.3, 1 - dy / 400));
    };
    const reset = (animate: boolean) => {
      stage.style.transition = animate ? "transform 150ms" : "";
      fade.style.transition = animate ? "opacity 150ms" : "";
      stage.style.transform = "";
      fade.style.opacity = "";
    };

    const on_down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || start || latest.current.blocked()) return;
      start = { id: event.pointerId, x: event.clientX, y: event.clientY };
      dragging = false;
      distance = 0;
    };
    const on_move = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      if (latest.current.blocked()) return cancel();
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < START_SLOP) return;
        if (dy <= 0 || dy < Math.abs(dx) * VERTICAL_BIAS) return cancel();
        dragging = true;
        reset(false);
      }
      distance = Math.max(0, dy);
      follow(distance);
    };
    const cancel = () => {
      if (dragging) reset(true);
      start = null;
      dragging = false;
    };
    const on_up = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      const close = dragging && event.type === "pointerup" && distance > CLOSE_DISTANCE;
      if (close) {
        start = null;
        dragging = false;
        latest.current.on_close();
      } else {
        cancel();
      }
    };
    // A second finger is a pinch: give up the swipe.
    const on_down_second = (event: PointerEvent) => {
      if (start && event.pointerId !== start.id) cancel();
    };

    stage.addEventListener("pointerdown", on_down);
    stage.addEventListener("pointerdown", on_down_second);
    stage.addEventListener("pointermove", on_move);
    stage.addEventListener("pointerup", on_up);
    stage.addEventListener("pointercancel", on_up);
    return () => {
      stage.removeEventListener("pointerdown", on_down);
      stage.removeEventListener("pointerdown", on_down_second);
      stage.removeEventListener("pointermove", on_move);
      stage.removeEventListener("pointerup", on_up);
      stage.removeEventListener("pointercancel", on_up);
    };
  }, [stage, fade]);
}
