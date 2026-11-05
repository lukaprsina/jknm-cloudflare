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
 * A link to "/" that always scrolls to the top. Left to the router, a click on the home page
 * is a no-op navigation, and from another page the router leaves the scroll position alone
 * when the new page's first element is already in view. A click that does not navigate this
 * tab (a new tab, a download, a handler that prevented it) leaves the scroll alone.
 */
export function HomeLink({ onClick, ...props }: Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link
      href="/"
      onClick={(event) => {
        onClick?.(event);
        const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (event.defaultPrevented || event.button !== 0 || modified) return;
        window.scrollTo({ top: 0 });
      }}
      {...props}
    />
  );
}
