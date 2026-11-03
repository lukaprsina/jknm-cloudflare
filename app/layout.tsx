import type { Metadata } from "next";
import "./globals.css";
import { Open_Sans } from "next/font/google";
import { CLUB_NAME } from "@/lib/club";
import { deployment_origin } from "@/lib/domains";

// Articles contain italics (`<i>`), so the italic face is loaded too.
const open_sans = Open_Sans({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL(deployment_origin()),
  title: { default: CLUB_NAME, template: `%s | ${CLUB_NAME}` },
  description:
    "Smo specialisti za dokumentirano raziskovanje in ohranjanje čistega ter zdravega podzemskega sveta.",
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sl" className={open_sans.variable}>
      <body>{children}</body>
    </html>
  );
}
