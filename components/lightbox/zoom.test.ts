import { describe, expect, test } from "vite-plus/test";
import { max_scale, NO_ZOOM, pan_by, toggle_zoom, zoom_to, type ZoomGeometry } from "./zoom";

// A 400x200 image resting in the middle of a 1000x1000 viewport (centre 500,500).
const geometry: ZoomGeometry = {
  rect: { x: 300, y: 400, width: 400, height: 200 },
  viewport: { width: 1000, height: 1000 },
  natural: { width: 400, height: 200 },
};

describe("max_scale", () => {
  test("is 3x the natural size: a small image shown at natural size zooms 3x", () => {
    expect(max_scale(geometry)).toBe(3);
  });

  test("an image shrunk to fit may zoom further, to reach 3x its natural pixels", () => {
    const shrunk = {
      ...geometry,
      rect: { ...geometry.rect, width: 1000, height: 500 },
      natural: { width: 4000, height: 2000 },
    };
    expect(max_scale(shrunk)).toBe(12);
  });
});

describe("zoom_to", () => {
  test("keeps the point under the cursor fixed", () => {
    // 100 px right of the image centre, zooming to 4x: the image slides 300 px left.
    const zoom = zoom_to(NO_ZOOM, { ...geometry, natural: { width: 1600, height: 800 } }, 4, {
      x: 600,
      y: 500,
    });
    expect(zoom).toEqual({ scale: 4, x: -300, y: 0 });
  });

  test("never goes below 1x and 1x is exactly the resting position", () => {
    const zoomed = zoom_to(NO_ZOOM, geometry, 3, { x: 600, y: 500 });
    expect(zoom_to(zoomed, geometry, 0.5, { x: 600, y: 500 })).toEqual(NO_ZOOM);
  });

  test("never goes above max_scale", () => {
    expect(zoom_to(NO_ZOOM, geometry, 50, { x: 500, y: 500 }).scale).toBe(3);
  });

  test("an image smaller than the viewport on an axis stays centred on that axis", () => {
    // 3x of 400x200 = 1200x600: wider than the viewport, shorter than it.
    const zoom = zoom_to(NO_ZOOM, geometry, 3, { x: 700, y: 100 });
    expect(zoom.y).toBe(0);
    expect(zoom.x).toBe(-100); // right edge of the image lands on the viewport edge
  });
});

describe("pan_by", () => {
  const zoomed = zoom_to(NO_ZOOM, { ...geometry, natural: { width: 1600, height: 800 } }, 4, {
    x: 600,
    y: 500,
  });

  test("moves the image but never past its edges", () => {
    expect(pan_by(zoomed, geometry, 100, 0).x).toBe(-200);
    expect(pan_by(zoomed, geometry, 5000, 0).x).toBe(300);
    expect(pan_by(zoomed, geometry, -5000, 0).x).toBe(-300);
  });

  test("does nothing when not zoomed", () => {
    expect(pan_by(NO_ZOOM, geometry, 100, 100)).toEqual(NO_ZOOM);
  });
});

describe("toggle_zoom", () => {
  test("zooms to 2x at the point, and back to rest", () => {
    const zoomed = toggle_zoom(NO_ZOOM, geometry, { x: 500, y: 500 });
    expect(zoomed.scale).toBe(2);
    expect(toggle_zoom(zoomed, geometry, { x: 500, y: 500 })).toEqual(NO_ZOOM);
  });

  test("zooms less than 2x when the image cannot go that far", () => {
    // A natural width of 100 px gives a max_scale below 1, which is raised to 1: no zoom at all.
    const tiny = { ...geometry, natural: { width: 100, height: 50 } };
    expect(toggle_zoom(NO_ZOOM, tiny, { x: 500, y: 500 }).scale).toBe(1);
  });
});
