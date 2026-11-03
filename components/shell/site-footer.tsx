import { MailIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";
import { CLUB, SOCIAL_LINKS } from "@/lib/club";
import { cn } from "@/lib/utils";
import { SocialIcon } from "../social-icon";
import { Sponsors } from "./sponsors";

const link = "hover:text-white hover:underline";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-footer-deep text-white">
      <div className="bg-linear-to-b from-footer to-footer-deep py-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 md:flex-row md:gap-12">
          <section className="flex-1">
            <h2 className="mb-4 text-xl font-bold">Vizitka</h2>
            <address className="mb-4 not-italic">
              {CLUB.name}
              {CLUB.address.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <div className="text-sm">
              <p>
                <strong>TRR:</strong> {CLUB.bank_account}
              </p>
              <p>
                <strong>Davčna številka:</strong> {CLUB.tax_number}
              </p>
              <p>Nismo zavezanci za DDV</p>
            </div>
          </section>
          <section className="flex-1">
            <h2 className="mb-4 text-xl font-bold">Stik z nami</h2>
            <ul className="flex flex-col gap-2">
              <li className="flex items-center gap-2">
                <MailIcon className="size-5" />
                <a href={`mailto:${CLUB.email}`} className={link}>
                  {CLUB.email}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <PhoneIcon className="size-5 shrink-0" />
                <span>
                  <a href={CLUB.phone.href} className={cn("whitespace-nowrap", link)}>
                    {CLUB.phone.label}
                  </a>
                  , {CLUB.phone.person}
                </span>
              </li>
            </ul>
          </section>
          <section className="flex-1">
            <h2 className="mb-4 text-xl font-bold">Spremljajte nas</h2>
            <div className="flex gap-4">
              {SOCIAL_LINKS.map(({ name, href }) => (
                <a key={name} href={href} target="_blank" rel="noreferrer" className={link}>
                  <SocialIcon name={name} className="size-6" />
                </a>
              ))}
            </div>
          </section>
        </div>
        <div className="mx-auto mt-10 max-w-7xl px-6">
          <Sponsors />
        </div>
      </div>
      <div className="border-t border-white/25">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-6 py-8 text-center text-sm">
          <p>
            &copy; {new Date().getFullYear()} {CLUB.name}. Vse pravice pridržane.
          </p>
          <Link href="/prijava" className="text-white/70 hover:text-white">
            Administrator
          </Link>
        </div>
      </div>
    </footer>
  );
}
