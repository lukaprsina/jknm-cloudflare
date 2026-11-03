"use client";

import { useEffect, useState } from "react";
import { Logo } from "./brand-image";
import { HomeLink } from "./nav-link";

export const HEADER_TOP_ID = "site-header-top";

/** The small logo in the sticky nav row, shown once the tall top block has scrolled away. */
export function MiniLogo() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const top = document.getElementById(HEADER_TOP_ID);
    if (!top) return;
    const observer = new IntersectionObserver(([entry]) => setShown(!entry.isIntersecting));
    observer.observe(top);
    return () => observer.disconnect();
  }, []);

  return (
    <HomeLink className={shown ? undefined : "invisible"}>
      <Logo className="h-8 w-auto" />
    </HomeLink>
  );
}
