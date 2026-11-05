"use client";

import { cn } from "cn";
import { Dialog } from "@base-ui/react/dialog";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Slide } from "./slide";
import type { LightboxImage } from "./types";
import { useElementSize } from "./use-element-size";
import { NO_ZOOM, type Zoom } from "./zoom";

const arrow_class =
  "absolute top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 disabled:opacity-30 md:grid";

export default function Lightbox({
  images,
  index,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
}) {
  const [stage, set_stage] = useState<HTMLDivElement | null>(null);
  const viewport = useElementSize(stage);
  const [embla_ref, embla] = useEmblaCarousel({ startSnap: index });
  const [active, set_active] = useState(index);
  const [zoom, set_zoom_state] = useState<Zoom>(NO_ZOOM);
  // Embla reads this on every pointer-down; a ref, so toggling zoom never re-initialises it.
  // Written together with the state so there is no render gap in which a drag could start.
  const zoomed = useRef(false);
  const set_zoom = (next: Zoom) => {
    zoomed.current = next.scale > 1;
    set_zoom_state(next);
  };

  // Leaving a slide resets its zoom. Done during render so the next slide never flashes zoomed.
  const [zoom_owner, set_zoom_owner] = useState(active);
  if (zoom_owner !== active) {
    set_zoom_owner(active);
    set_zoom(NO_ZOOM);
  }

  useEffect(() => {
    if (!embla) return;
    const on_select = () => set_active(embla.selectedSnap());
    embla.on("select", on_select);
    // Returning false cancels Embla's drag: a zoomed image pans instead of changing slide.
    const on_pointer_down = () => !zoomed.current;
    embla.on("pointerdown", on_pointer_down);
    return () => {
      embla.off("select", on_select);
      embla.off("pointerdown", on_pointer_down);
    };
  }, [embla]);

  const last = images.length - 1;
  const label = `Slika ${active + 1} od ${images.length}`;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Popup
          className="fixed inset-0 z-50 bg-black/95 outline-none"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") embla?.goToPrev();
            else if (event.key === "ArrowRight") embla?.goToNext();
            else if (event.key === "Home") embla?.goTo(0);
            else if (event.key === "End") embla?.goTo(last);
          }}
        >
          <Dialog.Title className="sr-only">Galerija slik</Dialog.Title>
          <div ref={set_stage} className="absolute inset-x-0 top-14 bottom-0">
            <div ref={embla_ref} className="h-full overflow-hidden">
              <div className="flex h-full">
                {images.map((image, i) => (
                  <Slide
                    key={i}
                    image={image}
                    viewport={viewport}
                    near={Math.abs(i - active) <= 1}
                    active={i === active}
                    zoom={i === active ? zoom : NO_ZOOM}
                    on_zoom={set_zoom}
                    on_close={onClose}
                  />
                ))}
              </div>
            </div>
            <button
              type="button"
              aria-label="Prejšnja slika"
              disabled={active === 0}
              onClick={() => embla?.goToPrev()}
              className={cn(arrow_class, "left-3")}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              aria-label="Naslednja slika"
              disabled={active === last}
              onClick={() => embla?.goToNext()}
              className={cn(arrow_class, "right-3")}
            >
              <ChevronRightIcon />
            </button>
          </div>
          <p aria-live="polite" className="sr-only">
            {label}
          </p>
          <div className="absolute inset-x-0 top-0 flex h-14 items-center justify-between px-4">
            <p aria-hidden className="text-sm text-white/80">
              {active + 1} / {images.length}
            </p>
            <Dialog.Close
              aria-label="Zapri"
              className="grid size-11 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60"
            >
              <XIcon />
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
