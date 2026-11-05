import { cn } from "cn";
import { useEffect, useState } from "react";
import { Inline } from "@/components/inline";
import { image_url } from "@/lib/image-url";
import type { LightboxImage } from "./types";
import { slide_layout } from "./slide-layout";
import type { Size } from "./slide-layout";
import { useZoomGestures } from "./use-zoom-gestures";
import type { Zoom } from "./zoom";

/** Width of an aside caption: 20 rem. */
const ASIDE_REM = 20;

function useRootFontSize(): number {
  const [size, set_size] = useState(16);
  useEffect(() => {
    set_size(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  }, []);
  return size;
}

/** Gap between the content and the screen edge, in px. */
const PADDING = 16;

const caption_class = "px-3 py-2 text-sm leading-snug text-white/90 [&_a]:underline";

/**
 * One lightbox slide. Every slide has a box the size of the viewport, so the strip lays out
 * without waiting for any image; only slides near the active one load their picture.
 */
export function Slide({
  image,
  viewport,
  near,
  active,
  zoom,
  on_zoom,
  on_close,
}: {
  image: LightboxImage;
  viewport: Size | null;
  near: boolean;
  active: boolean;
  zoom: Zoom;
  on_zoom: (next: Zoom) => void;
  on_close: () => void;
}) {
  const aside_width = ASIDE_REM * useRootFontSize();
  const [caption_height, set_caption_height] = useState<number | null>(null);
  const [measurer, set_measurer] = useState<HTMLDivElement | null>(null);
  const [img, set_img] = useState<HTMLImageElement | null>(null);
  const natural = { width: image.width, height: image.height };
  const has_caption = image.caption !== null && image.caption.length > 0;

  // The measurer is as wide as the caption really is. A taller caption narrows the image and so
  // the caption, which measures taller again; the height is capped in slide_layout, so it settles.
  useEffect(() => {
    if (!measurer) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize[0].blockSize;
      set_caption_height((previous) =>
        previous !== null && Math.abs(previous - height) < 0.5 ? previous : height,
      );
    });
    observer.observe(measurer);
    return () => observer.disconnect();
  }, [measurer]);

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
  useZoomGestures(active ? img : null, geometry, zoom, on_zoom);

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
          <img
            ref={set_img}
            src={image_url(image.url, image.width)}
            alt=""
            draggable={false}
            className="absolute max-w-none select-none"
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
          {has_caption && (
            <div
              ref={set_measurer}
              aria-hidden
              className={cn("invisible absolute top-0 left-0", caption_class)}
              style={{ width: caption_rect?.width }}
            >
              <Inline nodes={image.caption!} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
