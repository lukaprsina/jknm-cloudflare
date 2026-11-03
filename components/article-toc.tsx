"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { use_active_headings } from "@/components/use-active-headings";
import type { Heading } from "@/lib/prepare-article";
import { cn } from "@/lib/utils";

function Entries({
  headings,
  active,
  onPick,
}: {
  headings: Heading[];
  active?: string;
  onPick?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {headings.map((heading) => (
        <li key={heading.id} style={{ paddingLeft: `${Math.max(heading.depth - 2, 0)}rem` }}>
          <a
            href={`#${heading.id}`}
            onClick={onPick}
            aria-current={heading.id === active ? "location" : undefined}
            className={cn(
              "block py-0.5 text-muted-foreground hover:text-foreground",
              heading.id === active && "font-medium text-foreground",
            )}
          >
            {heading.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The table of contents: a sticky column on desktop, a sticky bar with a
 * popover below it. Place it as the first child of the article grid.
 */
export function ArticleToc({ headings }: { headings: Heading[] }) {
  const ids = useMemo(() => headings.map((heading) => heading.id), [headings]);
  const active = use_active_headings(ids);
  const [open, setOpen] = useState(false);
  const sections = headings.filter((heading) => heading.depth > 1);
  const current = headings.find((heading) => heading.id === active);

  return (
    <>
      <div className="sticky top-0 z-10 border-b bg-background lg:hidden">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm">
            <span className="truncate">{current?.title ?? "Kazalo"}</span>
            <ChevronDownIcon className="size-4 shrink-0" />
          </PopoverTrigger>
          <PopoverContent className="max-h-[70vh] w-(--anchor-width) overflow-y-auto">
            <Entries headings={sections} active={active} onPick={() => setOpen(false)} />
          </PopoverContent>
        </Popover>
      </div>
      <aside className="hidden lg:col-start-2 lg:row-start-1 lg:block">
        <nav
          aria-label="Kazalo"
          className="sticky top-(--article-scroll-margin) max-h-[calc(100vh-var(--article-scroll-margin))] overflow-y-auto pb-6"
        >
          <Entries headings={headings} active={active} />
        </nav>
      </aside>
    </>
  );
}
