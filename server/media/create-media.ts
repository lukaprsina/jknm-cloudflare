import { and, eq, lt, notExists } from "drizzle-orm";
import type { Db } from "../db";
import { Media, MediaToArticles } from "../db/schema";
import { ChecksumMismatch, type ImageInspector, type MediaBucket } from "./ports";
import type { Upload } from "./upload-request";

export type MediaRow = typeof Media.$inferSelect;

export type Ingested =
  | {
      ok: true;
      media: MediaRow;
      /** False when these bytes were already stored. */ created: boolean;
    }
  | { ok: false; message: string };

/** How long an unlinked upload may wait for its article to be saved. */
export const ORPHAN_GRACE_MS = 48 * 60 * 60 * 1000;

const rejected = (message: string): Ingested => ({ ok: false, message });

const key_of = ({ id, ext }: { id: string; ext: string }) => `${id}/original.${ext}`;

/**
 * Media storage: files go to the bucket, one immutable row each. `ingest`
 * stores an upload (once per distinct content); `sweep_orphans` removes
 * uploads no article ended up using.
 */
export function create_media({
  db,
  bucket,
  images,
}: {
  db: Db;
  bucket: MediaBucket;
  images: ImageInspector;
}) {
  const by_hash = async (sha256: string) =>
    (await db.select().from(Media).where(eq(Media.sha256, sha256)))[0];

  /** An image must be the format it claims; its size comes from Cloudflare, not the client. */
  async function inspect_image(key: string, upload: Upload) {
    const stored = await bucket.get(key);
    if (!stored) throw new Error(`${key} vanished after upload`);
    try {
      const info = await images.info(stored);
      return info.content_type === upload.content_type ? info : null;
    } catch {
      return null;
    }
  }

  async function ingest(body: ReadableStream, upload: Upload): Promise<Ingested> {
    const existing = await by_hash(upload.sha256);
    if (existing) return { ok: true, media: existing, created: false };

    const id = crypto.randomUUID();
    const key = key_of({ id, ext: upload.ext });
    try {
      await bucket.put(key, body, upload);
    } catch (error) {
      if (error instanceof ChecksumMismatch) {
        return rejected("Prenos je bil poškodovan, poskusite znova.");
      }
      throw error;
    }

    const is_image = upload.content_type.startsWith("image/");
    const size = is_image ? await inspect_image(key, upload) : null;
    if (is_image && !size) {
      await bucket.delete(key);
      return rejected("Datoteka ni veljavna slika.");
    }

    const [inserted] = await db
      .insert(Media)
      .values({
        id,
        ext: upload.ext,
        filename: upload.filename,
        content_type: upload.content_type,
        size_bytes: upload.length,
        sha256: upload.sha256,
        width: size?.width ?? null,
        height: size?.height ?? null,
        thumbhash: is_image ? upload.thumbhash : null,
      })
      .onConflictDoNothing({ target: Media.sha256 })
      .returning();
    if (inserted) return { ok: true, media: inserted, created: true };

    // The same bytes were committed by a concurrent upload; ours is the duplicate.
    await bucket.delete(key);
    return { ok: true, media: (await by_hash(upload.sha256))!, created: false };
  }

  /**
   * Deletes media no article links (a thumbnail counts as a link), older than
   * the grace period. The rows go first, in one statement, so a failure leaves a
   * stray object but never a row pointing at nothing.
   */
  async function sweep_orphans({ now }: { now: Date }) {
    const cutoff = new Date(now.getTime() - ORPHAN_GRACE_MS);
    const swept = await db
      .delete(Media)
      .where(
        and(
          lt(Media.created_at, cutoff),
          notExists(
            db.select().from(MediaToArticles).where(eq(MediaToArticles.media_id, Media.id)),
          ),
        ),
      )
      .returning({ id: Media.id, ext: Media.ext });
    for (const row of swept) await bucket.delete(key_of(row));
    return swept.length;
  }

  return { ingest, sweep_orphans };
}
