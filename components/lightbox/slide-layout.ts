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
  caption_height: number,
): SlideLayout {
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
export function slide_layout({
  image,
  viewport,
  has_caption,
  caption_height,
  aside_width,
}: SlideLayoutInput): SlideLayout {
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
