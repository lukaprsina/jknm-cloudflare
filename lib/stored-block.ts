import { z } from "zod";

/**
 * The shapes the editor stores in `content_json`, one per block type this site
 * renders. `ArticleBlockType.data` is `object` in the schema file because jsonb
 * is untrusted; parsing here is what turns it into something `prepare_article`
 * can read without casts. Lenient exactly where the renderer is (optional text,
 * caption, extension, size): the audit over production content must stay at
 * zero `unknown` blocks.
 */
/** Editor lists store items either as HTML strings (v1) or as `{ content, items }` objects (v2). */
export type StoredListItem = string | { content: string; items?: StoredListItem[] };

const list_item: z.ZodType<StoredListItem> = z.lazy(() =>
  z.union([z.string(), z.object({ content: z.string(), items: z.array(list_item).optional() })]),
);

const caption = z.string().optional();

export const stored_block = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("header"),
    data: z.object({ text: z.string().optional(), level: z.number() }),
  }),
  z.object({ type: z.literal("paragraph"), data: z.object({ text: z.string().optional() }) }),
  z.object({
    type: z.literal("list"),
    data: z.object({ style: z.string().optional(), items: z.array(list_item) }),
  }),
  z.object({
    type: z.literal("image"),
    data: z.object({
      file: z.object({ url: z.string(), width: z.number(), height: z.number() }),
      caption,
    }),
  }),
  z.object({
    type: z.literal("table"),
    data: z.object({
      content: z.array(z.array(z.string())),
      withHeadings: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("embed"),
    data: z.object({
      service: z.string(),
      embed: z.string(),
      // Only an aspect ratio; unusable values fall back in `prepare_article`.
      width: z.unknown().optional(),
      height: z.unknown().optional(),
      caption,
    }),
  }),
  z.object({
    type: z.literal("attaches"),
    data: z.object({
      title: z.string().optional(),
      file: z.object({
        url: z.string(),
        extension: z.string().optional(),
        size: z.number().optional(),
      }),
    }),
  }),
]);

export type StoredBlock = z.infer<typeof stored_block>;

const KNOWN = new Set<string>(stored_block.options.map((option) => option.shape.type.value));

/** Undefined for a block type this site does not render; throws when a known type is malformed. */
export function parse_stored_block(block: { type: string; data: object }) {
  return KNOWN.has(block.type) ? stored_block.parse(block) : undefined;
}
