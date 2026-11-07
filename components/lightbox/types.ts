import type { InlineNode } from "@/lib/inline-html";

/** What the lightbox needs to show one image: the stored (natural) size, never the display size. */
export type LightboxImage = {
  url: string;
  width: number;
  height: number;
  /** Base64 ThumbHash shown while the picture loads. */
  thumbhash?: string | null;
  caption: InlineNode[] | null;
};
