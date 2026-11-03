"use client";

import { usePathname } from "next/navigation";

/** Hides the footer on the home page, where the feed scrolls on without end. */
export function FooterGate({ children }: { children: React.ReactNode }) {
  return usePathname() === "/" ? null : children;
}
