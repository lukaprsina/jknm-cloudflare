"use client";

import { createContext, lazy, Suspense, useContext, useState } from "react";
import { push_lightbox_entry } from "../history-state";
import { useManualScrollRestoration } from "./scroll-restoration";
import { useReopenOnForward } from "./slide-history";
import type { LightboxImage } from "./types";

const LightboxView = lazy(() => import("./lightbox"));
const OpenContext = createContext<(index: number) => void>(() => {});

/** Owns open/close state for one article's images. The list is plain data. */
export function LightboxProvider({
  images,
  children,
}: {
  images: LightboxImage[];
  children: React.ReactNode;
}) {
  const [index, set_index] = useState<number | null>(null);
  const open_from_click = (at: number) => {
    push_lightbox_entry(at);
    set_index(at);
  };
  useManualScrollRestoration();
  useReopenOnForward(index !== null, images.length, set_index);
  return (
    <OpenContext value={open_from_click}>
      {children}
      {index !== null && (
        <Suspense fallback={null}>
          <LightboxView images={images} index={index} on_close={() => set_index(null)} />
        </Suspense>
      )}
    </OpenContext>
  );
}

/** Makes its children (an image) open the lightbox at `index`. A real button: focusable, Enter/Space. */
export function LightboxTrigger({ index, children }: { index: number; children: React.ReactNode }) {
  const open = useContext(OpenContext);
  return (
    <button
      type="button"
      onClick={() => open(index)}
      aria-label="Povečaj sliko"
      className="block cursor-zoom-in"
    >
      {children}
    </button>
  );
}
