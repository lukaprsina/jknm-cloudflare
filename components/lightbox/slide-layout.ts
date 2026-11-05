export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type SlideLayoutInput = {
  /** Stored (natural) pixel size. */
  image: Size;
  viewport: Size;
  has_caption: boolean;
  /** Measured height of the caption laid out at the image width; null until measured. */
  caption_height: number | null;
  /** Fixed width of an aside caption. */
  aside_width: number;
  /** Space kept free around the image and caption, so they never touch the screen edge. */
  padding?: number;
};

export type SlideLayout = {
  image_rect: Rect;
  caption: "none" | "aside" | "below";
  caption_rect: Rect | null;
};

/** Largest size that fits the area at the image's aspect ratio, never above its natural size. */
function fit(image: Size, area: Size): Size {
  const scale = Math.min(area.width / image.width, area.height / image.height, 1);
  return { width: image.width * scale, height: image.height * scale };
}

/** A caption below the image takes at most this share of the height; the rest scrolls. */
const MAX_BELOW_CAPTION = 0.4;

/** Width of an aside caption: 20 rem. */
export const ASIDE_REM = 20;

/** Gap between the content and the screen edge, in px. */
export const PADDING = 16;

/** The aside caption is only offered where a 20 rem pane can sit beside the image. */
const ASIDE_MIN_VIEWPORT = 768;

function centred_in(area: Size, size: Size): Rect {
  return { x: (area.width - size.width) / 2, y: (area.height - size.height) / 2, ...size };
}

/**
 * Below: the caption is as wide as the image. If the free bottom margin is too small the area
 * is lifted by min((caption - margin) * 2, caption) and, as in the plugin, the image is not
 * re-centred in the full viewport, so image plus caption end exactly at the bottom edge.
 */
function below_layout(
  image: Size,
  viewport: Size,
  full: Size,
  measured_height: number,
): SlideLayout {
  const caption_height = Math.min(measured_height, viewport.height * MAX_BELOW_CAPTION);
  const free_y = (viewport.height - full.height) / 2;
  const lift =
    free_y >= caption_height ? 0 : Math.min((caption_height - free_y) * 2, caption_height);
  const area = { width: viewport.width, height: viewport.height - lift };
  const image_rect = centred_in(area, fit(image, area));
  return {
    image_rect,
    caption: "below",
    caption_rect: {
      x: image_rect.x,
      y: image_rect.y + image_rect.height,
      width: image_rect.width,
      height: caption_height,
    },
  };
}

/**
 * Port of the PhotoSwipe dynamic-caption plugin's placement. The image is fitted to the whole
 * viewport and centred. The caption hugs it. Only if the caption does not fit in the free margin
 * is the area shrunk and the image refitted.
 */
function layout_inside({
  image,
  viewport,
  has_caption,
  caption_height,
  aside_width,
}: Omit<SlideLayoutInput, "padding">): SlideLayout {
  const full = fit(image, viewport);
  if (!has_caption)
    return { image_rect: centred_in(viewport, full), caption: "none", caption_rect: null };

  const free_x = (viewport.width - full.width) / 2;
  const free_y = (viewport.height - full.height) / 2;
  const aside = viewport.width >= ASIDE_MIN_VIEWPORT && free_x > free_y;
  if (!aside) return below_layout(image, viewport, full, caption_height ?? 0);

  // Aside: shrink the area by the caption width only when the free margin is too small.
  const area =
    free_x >= aside_width
      ? viewport
      : { width: viewport.width - aside_width, height: viewport.height };
  const size = fit(image, area);
  const image_rect = centred_in(area, size);
  return {
    image_rect,
    caption: "aside",
    caption_rect: {
      x: image_rect.x + image_rect.width,
      y: image_rect.y,
      width: aside_width,
      height: image_rect.height,
    },
  };
}

export function slide_layout({ padding = 0, ...input }: SlideLayoutInput): SlideLayout {
  const { viewport } = input;
  const inner = { width: viewport.width - 2 * padding, height: viewport.height - 2 * padding };
  const layout = layout_inside({ ...input, viewport: inner });
  const shift = (rect: Rect): Rect => ({ ...rect, x: rect.x + padding, y: rect.y + padding });
  return {
    ...layout,
    image_rect: shift(layout.image_rect),
    caption_rect: layout.caption_rect && shift(layout.caption_rect),
  };
}
