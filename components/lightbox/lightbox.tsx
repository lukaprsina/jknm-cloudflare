"use client";

import { cn } from "cn";
import { Dialog } from "@base-ui/react/dialog";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Slide } from "./slide";
import type { LightboxImage } from "./types";
import { useElementSize } from "./use-element-size";
import { useSwipeClose } from "./use-swipe-close";
import { ASIDE_REM } from "./slide-layout";
import { useSlideEntry } from "./slide-history";

const arrow_class =
  "absolute top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 disabled:opacity-30 md:grid";

function root_font_size(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

export default function Lightbox({
  images,
  index,
  on_close,
}: {
  images: LightboxImage[];
  index: number;
  on_close: () => void;
}) {
  // Closing fades out; the parent unmounts us (releasing Base UI's scroll lock) after.
  const [open, set_open] = useState(true);
  const [popup, set_popup] = useState<HTMLDivElement | null>(null);
  const [stage, set_stage] = useState<HTMLDivElement | null>(null);
  const viewport = useElementSize(stage);
  const [aside_width] = useState(() => ASIDE_REM * root_font_size());
  const [embla_ref, embla] = useEmblaCarousel({ startSnap: index });
  const [active, set_active] = useState(index);
  // Embla reads this on every pointer-down; a ref, so toggling zoom never re-initialises it.
  const zoomed = useRef(false);

  const close = useSlideEntry(active, set_open);

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

  useSwipeClose(stage, popup, () => zoomed.current, close);

  const last = images.length - 1;
  const label = `Slika ${active + 1} od ${images.length}`;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => !next && close()}
      onOpenChangeComplete={(is_open) => !is_open && on_close()}
    >
      <Dialog.Portal>
        <Dialog.Popup
          ref={set_popup}
          className="fixed inset-0 z-50 bg-black/95 outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") embla?.goToPrev();
            else if (event.key === "ArrowRight") embla?.goToNext();
            else if (event.key === "Home") embla?.goTo(0);
            else if (event.key === "End") embla?.goTo(last);
          }}
        >
          <Dialog.Title className="sr-only">Galerija slik</Dialog.Title>
          <div ref={set_stage} className="absolute inset-x-0 top-14 bottom-0 touch-none">
            <div ref={embla_ref} className="h-full overflow-hidden">
              <div className="flex h-full">
                {images.map((image, i) => (
                  <Slide
                    key={i}
                    image={image}
                    viewport={viewport}
                    aside_width={aside_width}
                    near={Math.abs(i - active) <= 1}
                    active={i === active}
                    on_zoomed={(is_zoomed) => (zoomed.current = is_zoomed)}
                    on_close={close}
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
