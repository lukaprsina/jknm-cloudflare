/** Origin media is served from. Existing `content_json` has these URLs baked in. */
export const MEDIA_ORIGIN = "https://gradivo.jknm.org";

const STORED_URL = new RegExp(
  `^${MEDIA_ORIGIN.replace(/\./g, "\\.")}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/original\\.\\w+$`,
);

/** Where a stored file is served from. */
export function media_url({ id, ext }: { id: string; ext: string }) {
  return `${MEDIA_ORIGIN}/${id}/original.${ext}`;
}

/** The `media` id a stored URL names, or null for any other URL (external images, variants, transforms). */
export function media_id_of(url: string): string | null {
  return STORED_URL.exec(url)?.[1] ?? null;
}

/** What the `media` row says about an image: display size (after EXIF rotation) and placeholder. Plain data. */
export interface ImageInfo {
  width: number;
  height: number;
  thumbhash: string | null;
}

/** The article's images by media id, as `media_id_of` names them. */
export type PageMedia = Record<string, ImageInfo>;

/** Where an image is shown; each variant is one fixed Cloudflare transform. */
export type ImageVariant = "body" | "lightbox" | "card" | "card-featured" | "og";

/** The rectangle `react-image-crop` emits: percent of the image, top-left origin. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What `image_src` needs to know about a stored image. */
export interface ImageSource {
  url: string;
  /** Stored pixel width; images no wider than the variant are served as stored. */
  width: number;
  /** Cards only: the part of the image to show. */
  crop?: Crop | null;
  /** Base64 ThumbHash, shown by `MediaImage` while the picture loads. */
  thumbhash?: string | null;
}

/** `height` makes a variant a cropped box; the others only shrink to `width`. `og` is JPEG for crawlers. */
const VARIANTS: Record<ImageVariant, { width: number; height?: number; format: string }> = {
  body: { width: 960, format: "auto" },
  lightbox: { width: 1600, format: "auto" },
  card: { width: 480, height: 270, format: "auto" },
  "card-featured": { width: 960, height: 540, format: "auto" },
  og: { width: 1200, format: "jpeg" },
};

const TRANSFORMABLE = /\.(?:jpe?g|png|gif|webp)$/i;

/** A fraction of the image, 0 to 1; crop rectangles overshoot by rounding error. */
const fraction = (value: number) => Number(Math.min(1, Math.max(0, value)).toFixed(4));

function trim_of({ x, y, width, height }: Crop) {
  const top = fraction(y / 100);
  const right = fraction(1 - (x + width) / 100);
  const bottom = fraction(1 - (y + height) / 100);
  const left = fraction(x / 100);
  return `trim=${top};${right};${bottom};${left}`;
}

/**
 * The URL to render for a stored image in a variant. Stored URLs stay the
 * media's identity; Cloudflare's `/cdn-cgi/image` (same host) does the resizing
 * and cropping, and only when it changes something: a source that is no wider
 * than the variant and has no crop is served as stored, which keeps the free
 * plan's monthly transform quota for images that need it. Anything Cloudflare
 * cannot transform (PDFs, AVIF, other hosts) is served as stored.
 *
 * Development serves the stored URL: `vp dev` has no `/cdn-cgi/image`, so
 * cards there show the whole image.
 */
export function image_src({ url, width, crop }: ImageSource, variant: ImageVariant): string {
  const wanted = VARIANTS[variant];
  const transformable = url.startsWith(`${MEDIA_ORIGIN}/`) && TRANSFORMABLE.test(url);
  const changes_something = crop != null || width > wanted.width;
  if (process.env.NODE_ENV !== "production" || !transformable || !changes_something) return url;

  const options = [
    ...(crop ? [trim_of(crop)] : []),
    `width=${wanted.width}`,
    ...(wanted.height ? [`height=${wanted.height}`, "fit=cover"] : ["fit=scale-down"]),
    `format=${wanted.format}`,
    "onerror=redirect",
  ];
  return `${MEDIA_ORIGIN}/cdn-cgi/image/${options.join(",")}/${url.slice(MEDIA_ORIGIN.length + 1)}`;
}

/**
 * The lightbox lays out and zooms against this size: the stored size, but never
 * more than the 1600 px picture it loads, so the largest zoom is not a stretched one.
 */
export function lightbox_natural({ width, height }: { width: number; height: number }) {
  const max = VARIANTS.lightbox.width;
  if (width <= max) return { width, height };
  return { width: max, height: Math.round((height * max) / width) };
}
