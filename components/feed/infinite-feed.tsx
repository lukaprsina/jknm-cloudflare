"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { load_more_feed } from "@/app/(site)/load-more-feed";
import { Sponsors } from "@/components/shell/sponsors";
import { Button } from "@/components/ui/button";
import type { FeedPage } from "@/server/published/create-published";
import { FeedCard } from "./feed-card";

type Feed = Pick<FeedPage, "cards" | "next_cursor">;

/**
 * The feeds that grew past the first page, by history entry. Back to such an entry shows the
 * list the visitor had, at full height, so the browser can restore the scroll position. A new
 * visit to `/` (the logo) is a new entry, so it starts from fresh server data. Memory only: a
 * reload starts over too, which also keeps hydration matching the server's HTML.
 */
const grown_feeds = new Map<number, Feed>();

/** vinext numbers every history entry; there is no public key for "this entry". */
function history_entry(): number | null {
  const index: unknown = history.state?.__vinext_historyIndex;
  return typeof index === "number" ? index : null;
}

/**
 * The homepage list: the server-rendered first page, then more as the visitor
 * nears the end or presses the button.
 */
export function InfiniteFeed({ first }: { first: FeedPage }) {
  const [feed, set_feed] = useState<Feed>(() => {
    const entry = typeof window === "undefined" ? null : history_entry();
    return (entry !== null && grown_feeds.get(entry)) || first;
  });
  const { cards, next_cursor: cursor } = feed;
  const [failed, setFailed] = useState(false);
  const [loading, start_loading] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);

  function load_more() {
    if (!cursor) return;
    const entry = history_entry(); // read now: the visitor may navigate away mid-load
    start_loading(async () => {
      try {
        const page = await load_more_feed(cursor);
        // A publish between two pages can repeat a card; ids are the identity.
        const ids = new Set(cards.map((card) => card.id));
        const grown = {
          cards: [...cards, ...page.cards.filter((card) => !ids.has(card.id))],
          next_cursor: page.next_cursor,
        };
        set_feed(grown);
        if (entry !== null) grown_feeds.set(entry, grown);
        setFailed(false);
      } catch {
        // The server's message is redacted in production, so there is nothing to show.
        setFailed(true);
      }
    });
  }

  // Re-armed after every page: if the sentinel is still in view, the next page follows.
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !cursor || loading || failed) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && load_more(), {
      rootMargin: "600px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, index) => (
          <Fragment key={card.id}>
            <FeedCard card={card} featured={index === 0} />
            {index === 0 && <Sponsors className="md:col-span-full" />}
          </Fragment>
        ))}
      </div>
      <div ref={sentinel} aria-busy={loading} className="mt-8 flex flex-col items-center gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {loading && "Nalagam …"}
          {failed && "Novic ni bilo mogoče naložiti."}
          {!cursor && "To je vse."}
        </p>
        {cursor && (
          <Button variant="outline" disabled={loading} onClick={load_more}>
            {failed ? "Poskusi znova" : "Več novic"}
          </Button>
        )}
      </div>
    </>
  );
}
