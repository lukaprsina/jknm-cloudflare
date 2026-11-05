"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { load_more_feed } from "@/app/(site)/load-more-feed";
import { Sponsors } from "@/components/shell/sponsors";
import { Button } from "@/components/ui/button";
import type { FeedPage } from "@/server/published/create-published";
import { history_entry } from "../history-state";
import { FeedCard } from "./feed-card";
import { append_page, create_feed_memory, type FeedState } from "./feed-state";

/** The server renders this component too, and has no history. */
const current_entry = () => (typeof window === "undefined" ? null : history_entry());
const feed_memory = create_feed_memory({ read_entry: current_entry, max: 5 });

/**
 * The homepage list: the server-rendered first page, then more as the visitor
 * nears the end or presses the button.
 */
export function InfiniteFeed({ first }: { first: FeedPage }) {
  // The server renders `first`; a reload finds the memory empty, so the client's first render
  // matches. Only a client-side Back finds a grown list here.
  const [feed, set_feed] = useState<FeedState>(() => feed_memory.recall() ?? first);
  const { cards, next_cursor: cursor } = feed;
  const [failed, setFailed] = useState(false);
  const [loading, start_loading] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  // The observer and the button can both fire before `loading` shows up in a render.
  const in_flight = useRef(false);
  const latest = useRef(feed);
  latest.current = feed;

  function load_more() {
    const { next_cursor } = latest.current;
    if (!next_cursor || in_flight.current) return;
    in_flight.current = true;
    const entry = history_entry(); // read now: the visitor may navigate away mid-load
    start_loading(async () => {
      try {
        const grown = append_page(latest.current, await load_more_feed(next_cursor));
        latest.current = grown;
        set_feed(grown);
        feed_memory.remember(entry, grown);
        setFailed(false);
      } catch {
        // The server's message is redacted in production, so there is nothing to show.
        setFailed(true);
      } finally {
        in_flight.current = false;
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
