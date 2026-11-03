import { CONTACT_EMAIL } from "@/lib/domains";

export const CLUB_NAME = "Jamarski klub Novo mesto";

/** Facts shown in the footer. */
export const CLUB = {
  name: CLUB_NAME,
  address: ["Seidlova cesta 29", "8000 Novo mesto"],
  bank_account: "02970-0020299064",
  tax_number: "82533113",
  email: CONTACT_EMAIL,
  phone: { href: "tel:+38641871385", label: "+386 (0)41 871 385", person: "Zdravko Bučar" },
} as const;

export const SOCIAL_LINKS = [
  { name: "Facebook", href: "https://www.facebook.com/jknovomesto" },
  { name: "YouTube", href: "https://www.youtube.com/@JamarskiKlubNovomesto" },
  { name: "Instagram", href: "https://www.instagram.com/jamarskiklubnm/" },
] as const;

/** Members' intranet (redirects to the Google Sites intranet). */
export const INTRANET_URL = "https://clani.jknm.si/";
