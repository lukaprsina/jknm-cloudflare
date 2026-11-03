import type { InlineNode } from "@/lib/inline-html";

/** React reader of the parsed inline HTML. Every link opens in a new tab (the admin's wish). */
export function Inline({ nodes }: { nodes: InlineNode[] }) {
  return nodes.map((node, index) => {
    if (typeof node === "string") return node;
    if (node.tag === "br") return <br key={index} />;
    const Tag = node.tag;
    const children = <Inline nodes={node.children} />;
    return Tag === "a" ? (
      <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <Tag key={index}>{children}</Tag>
    );
  });
}
