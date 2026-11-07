import type { ComponentProps } from "react";
import { thumbHashToDataURL } from "thumbhash";
import { image_src, type ImageSource, type ImageVariant } from "@/lib/media-url";

/** Placeholder pixels for a stored image: `thumbhash` is base64, as in the `media` table. */
function placeholder(thumbhash: string) {
  return thumbHashToDataURL(Uint8Array.from(atob(thumbhash), (char) => char.charCodeAt(0)));
}

/**
 * Every article image on the site: the variant's URL, plus a blurred
 * placeholder behind it while the picture loads. Other props go to the `<img>`.
 * Plain markup (no hooks), so it renders in server and client trees alike.
 */
export function MediaImage({
  image,
  variant,
  style,
  ...rest
}: {
  image: ImageSource & { thumbhash?: string | null };
  variant: ImageVariant;
} & Omit<ComponentProps<"img">, "src">) {
  return (
    // oxlint-disable-next-line next/no-img-element -- images skip the framework optimizer
    <img
      {...rest}
      src={image_src(image, variant)}
      style={
        image.thumbhash
          ? {
              backgroundImage: `url(${placeholder(image.thumbhash)})`,
              backgroundSize: "cover",
              ...style,
            }
          : style
      }
    />
  );
}
