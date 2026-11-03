import Link from "next/link";
import { image_url } from "@/lib/image-url";
import { cn } from "@/lib/utils";
import type { FeedCard as Card } from "@/server/published/create-published";

// Pinned zone, so server and client render the same date.
const date_format = new Intl.DateTimeFormat("sl-SI", {
  dateStyle: "long",
  timeZone: "Europe/Ljubljana",
});

/** One news item. Plain markup (no hooks), so it renders in server and client trees alike. */
export function FeedCard({ card, featured = false }: { card: Card; featured?: boolean }) {
  return (
    <article
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border bg-background",
        featured && "md:col-span-full md:flex-row",
      )}
    >
      {card.thumbnail && (
        <img
          src={image_url(card.thumbnail.url, featured ? 1200 : 600)}
          width={card.thumbnail.width}
          height={card.thumbnail.height}
          alt=""
          loading={featured ? "eager" : "lazy"}
          className={cn("aspect-video w-full object-cover", featured && "md:w-1/2")}
        />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4 md:p-5">
        <time dateTime={card.published_at} className="text-sm text-muted-foreground">
          {date_format.format(new Date(card.published_at))}
        </time>
        <h2 className={cn("font-bold", featured ? "text-2xl md:text-3xl" : "text-lg")}>
          <Link
            href={`/novica/${encodeURIComponent(card.slug)}`}
            className="after:absolute after:inset-0 hover:underline"
          >
            {card.title}
          </Link>
        </h2>
        {card.authors.length > 0 && (
          <p className="text-sm">{card.authors.map((author) => author.display_name).join(", ")}</p>
        )}
        {card.excerpt && <p className="line-clamp-4 text-muted-foreground">{card.excerpt}</p>}
      </div>
    </article>
  );
}
