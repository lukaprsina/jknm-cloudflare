import { Inline } from "@/components/inline";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { image_url } from "@/lib/image-url";
import type { InlineNode } from "@/lib/inline-html";
import type { ListItem, PreparedBlock } from "@/lib/prepare-article";
import { cn } from "@/lib/utils";

function List({ ordered, items }: { ordered: boolean; items: ListItem[] }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={cn("my-4 ml-6", ordered ? "list-decimal" : "list-disc")}>
      {items.map((item, index) => (
        <li key={index}>
          <Inline nodes={item.children} />
          {item.items.length > 0 && <List ordered={ordered} items={item.items} />}
        </li>
      ))}
    </Tag>
  );
}

function Caption({ nodes }: { nodes: InlineNode[] | null }) {
  return (
    nodes && (
      <figcaption className="text-brand">
        <Inline nodes={nodes} />
      </figcaption>
    )
  );
}

function Block({ block, eager }: { block: PreparedBlock; eager: boolean }) {
  switch (block.type) {
    case "header": {
      const Tag = block.depth === 1 ? "h1" : block.depth === 2 ? "h2" : "h3";
      return (
        <Tag
          id={block.id}
          className={cn(
            "scroll-mt-(--article-scroll-margin) font-semibold text-brand",
            block.depth === 1 && "text-3xl",
            block.depth === 2 && "mt-10 mb-2 text-2xl",
            block.depth === 3 && "mt-8 mb-2 text-xl",
          )}
        >
          <Inline nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="my-4">
          <Inline nodes={block.children} />
        </p>
      );
    case "list":
      return <List ordered={block.ordered} items={block.items} />;
    case "image":
      return (
        <figure className="my-6">
          {/* oxlint-disable-next-line next/no-img-element -- images skip the framework optimizer */}
          <img
            src={image_url(block.url, block.width)}
            width={block.width}
            height={block.height}
            alt=""
            loading={eager ? "eager" : "lazy"}
            className="block h-auto max-w-full"
          />
          <Caption nodes={block.caption} />
        </figure>
      );
    case "table":
      return (
        <Table className="my-6 border-collapse">
          {block.head && (
            <TableHeader>
              <TableRow>
                {block.head.map((cell, index) => (
                  <TableHead
                    key={index}
                    className={cn(
                      "h-auto font-bold whitespace-normal",
                      block.numeric_columns.includes(index) && "text-right",
                    )}
                  >
                    <Inline nodes={cell} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {block.rows.map((row, row_index) => (
              <TableRow key={row_index}>
                {row.map((cell, index) => (
                  <TableCell
                    key={index}
                    className={cn(
                      "whitespace-normal",
                      block.numeric_columns.includes(index) && "text-right tabular-nums",
                    )}
                  >
                    <Inline nodes={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    case "embed":
      return (
        <figure className="my-6">
          <iframe
            src={block.src}
            title="Video"
            loading="lazy"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ aspectRatio: `${block.width} / ${block.height}` }}
            className="h-auto w-full max-w-full"
          />
          <Caption nodes={block.caption} />
        </figure>
      );
    case "attaches":
      return (
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className="my-4 flex gap-3 rounded-md border p-3"
        >
          <span className="font-mono text-xs uppercase">{block.extension}</span>
          <span>{block.title}</span>
          <span className="ml-auto text-muted-foreground">{Math.ceil(block.size / 1024)} kB</span>
        </a>
      );
    case "unknown":
      console.warn(`article-body: unsupported block type "${block.kind}"`);
      return null;
  }
}

/** The article's blocks as markup. A server component: no client JS ships for the body itself. */
export function ArticleBody({ blocks }: { blocks: PreparedBlock[] }) {
  // The first image is usually above the fold; lazy-loading it would delay the largest paint.
  const first_image = blocks.findIndex((block) => block.type === "image");
  return blocks.map((block, index) => (
    <Block key={index} block={block} eager={index === first_image} />
  ));
}
