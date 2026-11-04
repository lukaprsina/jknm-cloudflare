"use client";

import { createContext, lazy, Suspense, useContext, useState } from "react";
import type { LightboxImage } from "./types";

const ArticleLightbox = lazy(() => import("./lightbox"));
const OpenContext = createContext<(index: number) => void>(() => {});

/** Owns open/close state for one article's images. The list is plain data. */
export function LightboxProvider({
  images,
  children,
}: {
  images: LightboxImage[];
  children: React.ReactNode;
}) {
  const [index, setIndex] = useState<number | null>(null);
  return (
    <OpenContext value={setIndex}>
      {children}
      {index !== null && (
        <Suspense fallback={null}>
          <ArticleLightbox images={images} index={index} onClose={() => setIndex(null)} />
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
