"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { load_more_feed } from "@/app/(site)/load-more-feed";
import { Sponsors } from "@/components/shell/sponsors";
import { Button } from "@/components/ui/button";
import type { FeedCursor, FeedPage } from "@/server/published/create-published";
import { history_entry } from "../history-state";
import { FeedCard } from "./feed-card";
import { append_page, create_feed_memory, type FeedState } from "./feed-state";

/** How many history entries keep their grown list; a few pages back is as far as anyone goes. */
const MEMORY_ENTRIES = 5;

const feed_memory = create_feed_memory({ read_entry: history_entry, max: MEMORY_ENTRIES });

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
  // The cursor already asked for. The observer and the button can both fire before the page
  // arrives and renders; a failure clears it so that retrying works.
  const requested = useRef<FeedCursor | null>(null);

  // A list that grew is remembered for this page's history entry. A page that finishes loading
  // after the visitor has left is not: its component is gone.
  const started_as = useRef(feed);
  useEffect(() => {
    if (feed !== started_as.current) feed_memory.remember(history_entry(), feed);
  }, [feed]);

  function load_more() {
    if (!cursor || requested.current === cursor) return;
    requested.current = cursor;
    start_loading(async () => {
      try {
        const page = await load_more_feed(cursor);
        set_feed((shown) => append_page(shown, page));
        setFailed(false);
      } catch {
        // The server's message is redacted in production, so there is nothing to show.
        requested.current = null;
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
