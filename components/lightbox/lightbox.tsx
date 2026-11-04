"use client";

import Lightbox, { useLightboxState } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "./lightbox.css";
import { Inline } from "@/components/inline";
import { image_url } from "@/lib/image-url";
import type { LightboxImage } from "./types";

const LABELS = {
  Previous: "Prejšnja slika",
  Next: "Naslednja slika",
  Close: "Zapri",
  Slide: "Slika",
  Carousel: "Diaprojekcija",
  Lightbox: "Povečava slike",
  "Photo gallery": "Slike v članku",
  "{index} of {total}": "{index} od {total}",
};

/** Lives inside the lightbox: laid out in the padding strip the container leaves free. */
function Caption({ images }: { images: LightboxImage[] }) {
  const { currentIndex } = useLightboxState();
  const caption = images[currentIndex]?.caption;
  if (!caption) return null;
  return (
    <figcaption className="jknm-lightbox-caption">
      <div className="jknm-lightbox-caption-text">
        <Inline nodes={caption} />
      </div>
    </figcaption>
  );
}

/** Loaded on demand: the article page ships none of this until an image is opened. */
export default function ArticleLightbox({
  images,
  index,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
}) {
  return (
    <Lightbox
      open
      close={onClose}
      index={index}
      className="jknm-lightbox"
      plugins={[Zoom]}
      labels={LABELS}
      // Caption text is the description; the image itself needs no second alt.
      slides={images.map((image) => ({
        src: image_url(image.url, image.width),
        width: image.width,
        height: image.height,
        alt: "",
      }))}
      animation={{ fade: 200 }}
      carousel={{ finite: false, preload: 2 }}
      controller={{ closeOnBackdropClick: true }}
      zoom={{ pinchZoomV4: true, maxZoomPixelRatio: 3, scrollToZoom: true }}
      render={{ controls: () => <Caption images={images} /> }}
    />
  );
}
