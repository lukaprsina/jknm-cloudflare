import { useEffect, useState } from "react";
import type { Size } from "./slide-layout";

/** Content-box size of `element`, or null until it has been measured. */
export function useElementSize(element: HTMLElement | null): Size | null {
  const [size, set_size] = useState<Size | null>(null);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      set_size((previous) =>
        previous?.width === width && previous.height === height ? previous : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}
