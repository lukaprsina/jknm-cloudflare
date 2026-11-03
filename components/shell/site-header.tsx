import { UsersIcon } from "lucide-react";
import { CLUB_NAME, INTRANET_URL, SOCIAL_LINKS } from "@/lib/club";
import { CONTENT_PAGES } from "@/lib/content-pages";
import { cn } from "@/lib/utils";
import { SocialIcon } from "../social-icon";
import { Logo } from "./brand-image";
import { MiniLogo, HEADER_TOP_ID } from "./mini-logo";
import { MobileMenu } from "./mobile-menu";
import { HomeLink, NavLink } from "./nav-link";

const gutter = "mx-auto w-full max-w-7xl px-6";

/**
 * Below `lg` a sticky bar with the menu sheet; from `lg` a tall top block and a
 * sticky nav row. `contents`: the sticky rows must be direct children of the
 * page wrapper, because a boxed `<header>` ends where its content ends and
 * would stop them sticking. Their heights are `--header-h` (globals.css).
 */
export function SiteHeader() {
  return (
    <header className="contents">
      <div className="sticky top-0 z-40 flex h-(--header-h) items-center justify-between gap-4 border-b bg-background px-4 lg:hidden">
        <HomeLink className="text-xl font-bold">{CLUB_NAME}</HomeLink>
        <MobileMenu />
      </div>

      <div id={HEADER_TOP_ID} className="hidden h-45.5 border-b py-4 lg:block">
        <div className={cn(gutter, "flex h-full")}>
          <div className="flex flex-1 items-end gap-4 pb-1">
            {SOCIAL_LINKS.map(({ name, href }) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="p-1 hover:text-brand"
              >
                <SocialIcon name={name} className="size-6" />
              </a>
            ))}
          </div>
          <div className="flex flex-1 items-center justify-center">
            <HomeLink>
              <Logo className="w-auto min-w-72" />
            </HomeLink>
          </div>
          <div className="flex flex-1 items-end justify-end pb-1">
            <a href={INTRANET_URL} aria-label="Za člane" className="p-1 hover:text-brand">
              <UsersIcon />
            </a>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-40 hidden h-(--header-h) items-center border-b bg-background lg:flex">
        <div className={cn(gutter, "flex items-center")}>
          <div className="flex-1">
            <MiniLogo />
          </div>
          <nav aria-label="Glavna navigacija" className="flex items-center gap-1">
            {CONTENT_PAGES.map(({ slug, title }) => (
              <NavLink
                key={slug}
                href={`/${slug}`}
                className="rounded-md px-3 py-2 text-base font-medium hover:bg-accent aria-[current=page]:text-brand"
              >
                {title}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
        </div>
      </div>
    </header>
  );
}
