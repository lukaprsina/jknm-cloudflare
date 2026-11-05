"use client";

import { createContext, lazy, Suspense, useContext, useState } from "react";
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
  // The lightbox owns one history entry (#slika-N, same page), so the back button closes it.
  // Both ends are here: the lightbox only asks for history.back() and closes on popstate.
  const open = (at: number) => {
    history.pushState(history.state, "", `#slika-${at + 1}`);
    set_index(at);
  };
  return (
    <OpenContext value={open}>
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
