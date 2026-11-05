import { useEffect, useLayoutEffect, useRef } from "react";
import { pan_by, toggle_zoom, zoom_to, type Point, type Zoom, type ZoomGeometry } from "./zoom";

const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 30;
const ARROW_PAN = 80;
const ARROW_PAN_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [ARROW_PAN, 0],
  ArrowRight: [-ARROW_PAN, 0],
  ArrowUp: [0, ARROW_PAN],
  ArrowDown: [0, -ARROW_PAN],
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Binds wheel, mouse click, drag-pan, double-tap, pinch and arrow-key panning on `element`
 * to the pure zoom functions. Points are relative to the slide, i.e. in viewport coordinates
 * of the layout.
 */
export function useZoomGestures(
  element: HTMLElement | null,
  geometry: ZoomGeometry | null,
  zoom: Zoom,
  on_zoom: (next: Zoom) => void,
) {
  const latest = useRef({ geometry, zoom, on_zoom });
  useLayoutEffect(() => {
    latest.current = { geometry, zoom, on_zoom };
  });

  useEffect(() => {
    if (!element) return;
    const pointers = new Map<number, Point>();
    let moved = 0;
    let multi_touch = false;
    let last_tap: { at: number; point: Point } | null = null;

    // The stage may not start at the window origin (the toolbar sits above it), so gesture
    // points are made relative to the slide, which is what the zoom geometry is measured in.
    const local = (event: PointerEvent | WheelEvent): Point => {
      const origin = element.parentElement!.getBoundingClientRect();
      return { x: event.clientX - origin.left, y: event.clientY - origin.top };
    };

    const apply = (next: (zoom: Zoom, geometry: ZoomGeometry) => Zoom) => {
      const { geometry, zoom, on_zoom } = latest.current;
      if (!geometry) return;
      const result = next(zoom, geometry);
      // Several events can arrive before React re-renders; each must build on the last result.
      latest.current.zoom = result;
      on_zoom(result);
    };

    const on_wheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      apply((zoom, geometry) => zoom_to(zoom, geometry, zoom.scale * factor, local(event)));
    };

    const on_down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      element.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, local(event));
      if (pointers.size === 1) {
        moved = 0;
        multi_touch = false;
      } else {
        multi_touch = true;
      }
    };

    const on_move = (event: PointerEvent) => {
      const before = pointers.get(event.pointerId);
      if (!before) return;
      const point = local(event);
      const others = [...pointers].filter(([id]) => id !== event.pointerId).map(([, p]) => p);
      pointers.set(event.pointerId, point);
      moved += distance(before, point);
      if (others.length === 1) {
        // Pinch: scale by the change in finger distance around the midpoint, and follow the midpoint.
        const [other] = others;
        const ratio = distance(point, other) / (distance(before, other) || 1);
        const from = midpoint(before, other);
        const to = midpoint(point, other);
        apply((zoom, geometry) =>
          pan_by(
            zoom_to(zoom, geometry, zoom.scale * ratio, to),
            geometry,
            to.x - from.x,
            to.y - from.y,
          ),
        );
      } else if (others.length === 0 && latest.current.zoom.scale > 1) {
        apply((zoom, geometry) => pan_by(zoom, geometry, point.x - before.x, point.y - before.y));
      }
    };

    const on_up = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      const is_tap =
        !multi_touch && pointers.size === 0 && moved < TAP_SLOP && event.type === "pointerup";
      if (!is_tap) return;
      const point = local(event);
      if (event.pointerType === "mouse") {
        apply((zoom, geometry) => toggle_zoom(zoom, geometry, point));
        return;
      }
      const now = event.timeStamp;
      if (
        last_tap &&
        now - last_tap.at < DOUBLE_TAP_MS &&
        distance(last_tap.point, point) < DOUBLE_TAP_DISTANCE
      ) {
        apply((zoom, geometry) => toggle_zoom(zoom, geometry, point));
        last_tap = null;
      } else {
        last_tap = { at: now, point };
      }
    };

    // Capture phase on window: while zoomed, arrows pan instead of changing slide.
    const on_key = (event: KeyboardEvent) => {
      const pan = ARROW_PAN_KEYS[event.key];
      if (!pan || latest.current.zoom.scale <= 1) return;
      event.preventDefault();
      event.stopPropagation();
      apply((zoom, geometry) => pan_by(zoom, geometry, pan[0], pan[1]));
    };

    element.addEventListener("wheel", on_wheel, { passive: false });
    element.addEventListener("pointerdown", on_down);
    element.addEventListener("pointermove", on_move);
    element.addEventListener("pointerup", on_up);
    element.addEventListener("pointercancel", on_up);
    window.addEventListener("keydown", on_key, true);
    return () => {
      element.removeEventListener("wheel", on_wheel);
      element.removeEventListener("pointerdown", on_down);
      element.removeEventListener("pointermove", on_move);
      element.removeEventListener("pointerup", on_up);
      element.removeEventListener("pointercancel", on_up);
      window.removeEventListener("keydown", on_key, true);
    };
  }, [element]);
}
