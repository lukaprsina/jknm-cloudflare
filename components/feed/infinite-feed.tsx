"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { load_more_feed } from "@/app/(site)/load-more-feed";
import { Sponsors } from "@/components/shell/sponsors";
import { Button } from "@/components/ui/button";
import type { FeedPage } from "@/server/published/create-published";
import { FeedCard } from "./feed-card";

/**
 * The homepage list: the server-rendered first page, then more as the visitor
 * nears the end or presses the button. Going back to `/` shows the first page
 * again; the client state is not retained.
 */
export function InfiniteFeed({ first }: { first: FeedPage }) {
  const [cards, setCards] = useState(first.cards);
  const [cursor, setCursor] = useState(first.next_cursor);
  const [failed, setFailed] = useState(false);
  const [loading, start_loading] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);

  function load_more() {
    if (!cursor) return;
    start_loading(async () => {
      try {
        const page = await load_more_feed(cursor);
        // A publish between two pages can repeat a card; ids are the identity.
        setCards((shown) => {
          const ids = new Set(shown.map((card) => card.id));
          return [...shown, ...page.cards.filter((card) => !ids.has(card.id))];
        });
        setCursor(page.next_cursor);
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
