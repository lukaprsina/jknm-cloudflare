"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

/** A link that marks itself `aria-current` on its own page. */
export function NavLink({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const current = usePathname() === href;
  return <Link href={href} aria-current={current ? "page" : undefined} {...props} />;
}

/**
 * A link to "/" that also scrolls to the top when clicked on the home page: a
 * same-route click is a no-op navigation, so it would otherwise leave the page where it is.
 */
export function HomeLink({ onClick, ...props }: Omit<ComponentProps<typeof Link>, "href">) {
  const pathname = usePathname();
  return (
    <Link
      href="/"
      onClick={(event) => {
        if (pathname === "/") window.scrollTo({ top: 0 });
        onClick?.(event);
      }}
      {...props}
    />
  );
}
