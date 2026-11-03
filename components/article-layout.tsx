import type { ReactNode } from "react";
import { ArticleToc } from "@/components/article-toc";
import type { Heading } from "@/lib/prepare-article";
import { cn } from "@/lib/utils";

/**
 * The article page's frame. Only H2/H3 make a table of contents worth showing:
 * with them, a two-column grid with `ArticleToc` beside the text; without, a
 * single centered column. The grid placement, the mobile bar's order and its
 * `-mx-4` (which assumes the `px-4` here) are this module's contract with
 * `ArticleToc`. The anchor offset they share is `--article-scroll-margin`
 * (globals.css).
 */
export function ArticleLayout({
  headings,
  children,
}: {
  headings: Heading[];
  children: ReactNode;
}) {
  const has_toc = headings.some((heading) => heading.depth === 2 || heading.depth === 3);
  return (
    <main
      className={cn(
        "mx-auto px-4 pb-10",
        has_toc ? "max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10" : "max-w-3xl",
      )}
    >
      {has_toc && <ArticleToc headings={headings} />}
      <article className="pt-6 lg:col-start-1 lg:row-start-1 [&_a]:underline">{children}</article>
    </main>
  );
}
