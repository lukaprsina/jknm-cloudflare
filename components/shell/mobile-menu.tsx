"use client";

import { MenuIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CLUB_NAME, INTRANET_URL, SOCIAL_LINKS } from "@/lib/club";
import { CONTENT_PAGES } from "@/lib/content-pages";
import { SocialIcon } from "../social-icon";
import { Logo } from "./brand-image";
import { HomeLink, NavLink } from "./nav-link";
import { Sponsors } from "./sponsors";

const link_class =
  "rounded-md px-2 py-2 text-base font-medium hover:bg-accent aria-[current=page]:text-brand";

/** The navigation sheet below `lg`. Links close it, since the layout survives navigations. */
export function MobileMenu() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="icon" className="shrink-0" />}>
        <MenuIcon />
        <span className="sr-only">Meni</span>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="sr-only">{CLUB_NAME}</SheetTitle>
          <SheetClose nativeButton={false} render={<HomeLink className="w-32" />}>
            <Logo />
          </SheetClose>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-8">
          <nav aria-label="Glavna navigacija" className="flex flex-col gap-1">
            {CONTENT_PAGES.map(({ slug, title }) => (
              <SheetClose
                key={slug}
                nativeButton={false}
                render={<NavLink href={`/${slug}`} className={link_class} />}
              >
                {title}
              </SheetClose>
            ))}
          </nav>
          <div className="flex items-center gap-4 border-t pt-4">
            {SOCIAL_LINKS.map(({ name, href }) => (
              <a key={name} href={href} target="_blank" rel="noreferrer" className="p-1">
                <SocialIcon name={name} className="size-6" />
              </a>
            ))}
            <a href={INTRANET_URL} className="p-1" aria-label="Za člane">
              <UsersIcon />
            </a>
          </div>
          <Sponsors compact />
        </div>
      </SheetContent>
    </Sheet>
  );
}
