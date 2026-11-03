import type { Metadata } from "next";
import { InfiniteFeed } from "@/components/feed/infinite-feed";
import { CLUB_NAME, SOCIAL_LINKS } from "@/lib/club";
import { deployment_origin } from "@/lib/domains";
import { json_ld } from "@/lib/json-ld";
import { get_published } from "@/server/published";

export const revalidate = 3600;

export const metadata: Metadata = {
  alternates: { canonical: `${deployment_origin()}/` },
};

export default async function Home() {
  const first = await get_published().first_page();
  const url = `${deployment_origin()}/`;
  const structured_data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: CLUB_NAME,
        url,
        sameAs: SOCIAL_LINKS.map((link) => link.href),
      },
      { "@type": "WebSite", name: CLUB_NAME, url },
    ],
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: json_ld(structured_data) }}
      />
      <h1 className="sr-only">{CLUB_NAME}: novice</h1>
      <InfiniteFeed first={first} />
    </div>
  );
}
