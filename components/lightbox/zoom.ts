import type { Rect, Size } from "./slide-layout";

/**
 * `scale` multiplies the fitted image size. `x`/`y` move the image centre away from its
 * resting position, in viewport pixels. Applied as `translate(x, y) scale(scale)` with the
 * transform origin at the image centre.
 */
export type Zoom = { scale: number; x: number; y: number };
export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

export type Point = { x: number; y: number };

export type ZoomGeometry = {
  /** Resting (scale 1) image rectangle, in viewport coordinates. */
  rect: Rect;
  viewport: Size;
  /** Stored pixel size. */
  natural: Size;
};

/** Zoom reaches 3x the image's own pixels, so a 480 px image magnifies 3x, not 3x of its enlarged display. */
const NATURAL_ZOOM = 3;
const TOGGLE_SCALE = 2;
/** Zoom range over which an axis that fits drifts from its resting spot to the viewport centre. */
const RECENTRE_RANGE = 0.5;

export function max_scale({ rect, natural }: ZoomGeometry): number {
  return Math.max(1, (NATURAL_ZOOM * natural.width) / rect.width);
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Translation on one axis keeping the zoomed image covering the viewport, or centred if it is smaller. */
function clamp_axis(
  translation: number,
  scale: number,
  rest_start: number,
  length: number,
  view: number,
): number {
  const rest_centre = rest_start + length / 2;
  const half = (length * scale) / 2;
  if (half * 2 <= view) {
    const blend = clamp((scale - 1) / RECENTRE_RANGE, 0, 1);
    return (view / 2 - rest_centre) * blend;
  }
  return clamp(rest_centre + translation, view - half, half) - rest_centre;
}

function settle(zoom: Zoom, { rect, viewport }: ZoomGeometry): Zoom {
  if (zoom.scale <= 1) return NO_ZOOM;
  return {
    scale: zoom.scale,
    x: clamp_axis(zoom.x, zoom.scale, rect.x, rect.width, viewport.width),
    y: clamp_axis(zoom.y, zoom.scale, rect.y, rect.height, viewport.height),
  };
}

/** Zoom to `scale` (clamped to 1..max_scale), keeping the viewport point `focal` still. */
export function zoom_to(zoom: Zoom, geometry: ZoomGeometry, scale: number, focal: Point): Zoom {
  const next = clamp(scale, 1, max_scale(geometry));
  const centre = {
    x: geometry.rect.x + geometry.rect.width / 2,
    y: geometry.rect.y + geometry.rect.height / 2,
  };
  const ratio = next / zoom.scale;
  return settle(
    {
      scale: next,
      x: focal.x - centre.x - ratio * (focal.x - centre.x - zoom.x),
      y: focal.y - centre.y - ratio * (focal.y - centre.y - zoom.y),
    },
    geometry,
  );
}

export function pan_by(zoom: Zoom, geometry: ZoomGeometry, dx: number, dy: number): Zoom {
  return settle({ scale: zoom.scale, x: zoom.x + dx, y: zoom.y + dy }, geometry);
}

/** Click or double-tap: 2x at the point, or back to rest if already zoomed. */
export function toggle_zoom(zoom: Zoom, geometry: ZoomGeometry, focal: Point): Zoom {
  if (zoom.scale > 1) return NO_ZOOM;
  return zoom_to(zoom, geometry, TOGGLE_SCALE, focal);
}
