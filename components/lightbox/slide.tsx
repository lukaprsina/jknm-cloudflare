import { cn } from "cn";
import { useEffect, useState } from "react";
import { Inline } from "@/components/inline";
import { MediaImage } from "@/components/media-image";
import { lightbox_natural } from "@/lib/media-url";
import type { LightboxImage } from "./types";
import { PADDING, slide_layout } from "./slide-layout";
import type { Size } from "./slide-layout";
import { useZoomGestures } from "./use-zoom-gestures";
import { NO_ZOOM, type Zoom } from "./zoom";

const caption_class = "px-3 py-2 text-sm leading-snug text-white/90 [&_a]:underline";

/**
 * One lightbox slide. Every slide has a box the size of the viewport, so the strip lays out
 * without waiting for any image; only slides near the active one load their picture.
 */
export function Slide({
  image,
  viewport,
  aside_width,
  near,
  active,
  on_zoomed,
  on_close,
}: {
  image: LightboxImage;
  viewport: Size | null;
  aside_width: number;
  near: boolean;
  active: boolean;
  /** Tells the lightbox whether this slide is zoomed, so a drag pans instead of swiping. */
  on_zoomed: (zoomed: boolean) => void;
  on_close: () => void;
}) {
  const [zoom, set_zoom_state] = useState<Zoom>(NO_ZOOM);
  const set_zoom = (next: Zoom) => {
    on_zoomed(next.scale > 1);
    set_zoom_state(next);
  };
  // Leaving the slide resets its zoom.
  useEffect(() => {
    if (!active && zoom !== NO_ZOOM) set_zoom(NO_ZOOM);
  });
  const [caption_height, set_caption_height] = useState<number | null>(null);
  const [caption_el, set_caption_el] = useState<HTMLDivElement | null>(null);
  const [img, set_img] = useState<HTMLImageElement | null>(null);
  const natural = lightbox_natural(image);
  const has_caption = image.caption !== null && image.caption.length > 0;

  // The caption's full height at its real width: scrollHeight ignores the max-height cap, so the
  // visible element measures itself. A taller caption narrows the image and so the caption, which
  // measures taller again; the height is capped in slide_layout, so it settles.
  useEffect(() => {
    if (!caption_el) return;
    const observer = new ResizeObserver(() => {
      const height = caption_el.scrollHeight;
      set_caption_height((previous) =>
        previous !== null && Math.abs(previous - height) < 0.5 ? previous : height,
      );
    });
    observer.observe(caption_el);
    return () => observer.disconnect();
  }, [caption_el]);

  const layout =
    near && viewport
      ? slide_layout({
          image: natural,
          viewport,
          has_caption,
          caption_height,
          aside_width,
          padding: PADDING,
        })
      : null;
  const geometry = layout && viewport ? { rect: layout.image_rect, viewport, natural } : null;
  useZoomGestures(active ? img : null, geometry, zoom, set_zoom);

  const rect = layout?.image_rect;
  const caption_rect = layout?.caption_rect;
  const zoomed = zoom.scale > 1;
  const measured = layout?.caption === "aside" || caption_height !== null;

  return (
    <div
      className="relative h-full min-w-0 flex-[0_0_100%] overflow-hidden"
      inert={!active}
      onClick={(event) => event.target === event.currentTarget && on_close()}
    >
      {layout && rect && (
        <>
          <MediaImage
            ref={set_img}
            image={image}
            variant="lightbox"
            alt=""
            draggable={false}
            className="absolute max-w-none bg-white/5 select-none"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
              touchAction: active ? "none" : undefined,
              cursor: zoomed ? "grab" : "zoom-in",
            }}
          />
          {has_caption && caption_rect && (
            <div
              ref={set_caption_el}
              className={cn(
                "absolute touch-pan-y overflow-y-auto transition-opacity",
                caption_class,
              )}
              style={{
                left: caption_rect.x,
                top: caption_rect.y,
                width: caption_rect.width,
                maxHeight: caption_rect.height,
                opacity: zoomed || !measured ? 0 : 1,
                pointerEvents: zoomed ? "none" : undefined,
              }}
            >
              <Inline nodes={image.caption!} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
