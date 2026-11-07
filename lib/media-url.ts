import { MEDIA_ORIGIN } from "@/server/article/content-media";

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
  crop?: Crop;
}

const VARIANTS: Record<ImageVariant, { width: number; height?: number }> = {
  body: { width: 960 },
  lightbox: { width: 1600 },
  card: { width: 480, height: 270 },
  "card-featured": { width: 960, height: 540 },
  og: { width: 1200 },
};

const TRANSFORMABLE = /\.(?:jpe?g|png|gif|webp)$/i;

/** A fraction of the image, 0 to 1; crop rectangles overshoot by rounding error. */
const fraction = (value: number) => +Math.min(1, Math.max(0, value)).toFixed(4);

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
  const changes_something = crop !== undefined || width > wanted.width;
  if (process.env.NODE_ENV !== "production" || !transformable || !changes_something) return url;

  const options = [
    ...(crop ? [trim_of(crop)] : []),
    `width=${wanted.width}`,
    ...(wanted.height ? [`height=${wanted.height}`, "fit=cover"] : ["fit=scale-down"]),
    `format=${variant === "og" ? "jpeg" : "auto"}`,
    "onerror=redirect",
  ];
  return `${MEDIA_ORIGIN}/cdn-cgi/image/${options.join(",")}/${url.slice(MEDIA_ORIGIN.length + 1)}`;
}
