import { beforeEach, describe, expect, test } from "vite-plus/test";
import { Article, Media, MediaToArticles } from "../db/schema";
import { create_test_db, insert_media } from "../db/test-helpers";
import type { Db } from "../db";
import { create_media } from "./create-media";
import type { Upload } from "./upload-request";
import { memory_bucket, png_bytes, png_inspector, sha256_hex, stream_of } from "./test-adapters";

let db: Db;
let bucket: ReturnType<typeof memory_bucket>;
let media: ReturnType<typeof create_media>;

beforeEach(async () => {
  db = await create_test_db();
  bucket = memory_bucket();
  media = create_media({ db, bucket, images: png_inspector });
});

async function upload_of(bytes: Uint8Array, overrides: Partial<Upload> = {}): Promise<Upload> {
  return {
    filename: "foto.png",
    content_type: "image/png",
    ext: "png",
    length: bytes.length,
    sha256: await sha256_hex(bytes),
    thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j3A",
    ...overrides,
  };
}

const ingest = async (bytes: Uint8Array, overrides: Partial<Upload> = {}) =>
  media.ingest(stream_of(bytes), await upload_of(bytes, overrides));

describe("ingest", () => {
  test("an image is stored under its id, with the size R2 reports and the placeholder", async () => {
    const bytes = png_bytes(800, 600);
    const result = await ingest(bytes);
    if (!result.ok) throw new Error(result.message);

    expect(result.created).toBe(true);
    expect(result.media).toMatchObject({
      ext: "png",
      filename: "foto.png",
      content_type: "image/png",
      size_bytes: bytes.length,
      width: 800,
      height: 600,
      thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j3A",
    });
    expect([...bucket.objects.keys()]).toEqual([`${result.media.id}/original.png`]);
    expect(await db.select().from(Media)).toHaveLength(1);
  });

  test("a pdf is a plain file: no size, no placeholder", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 zapisnik");
    const result = await ingest(bytes, {
      filename: "zapisnik.pdf",
      content_type: "application/pdf",
      ext: "pdf",
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.media).toMatchObject({
      content_type: "application/pdf",
      width: null,
      height: null,
      thumbhash: null,
    });
  });

  test("the same bytes again return the existing row and store nothing new", async () => {
    const bytes = png_bytes(10, 10);
    const first = await ingest(bytes);
    const again = await ingest(bytes, { filename: "drugo-ime.png" });
    if (!first.ok || !again.ok) throw new Error("rejected");

    expect(again.created).toBe(false);
    expect(again.media.id).toBe(first.media.id);
    expect(again.media.filename).toBe("foto.png");
    expect(bucket.objects.size).toBe(1);
  });

  test("when another upload of the same bytes commits first, its row is returned and our object is deleted", async () => {
    const bytes = png_bytes(10, 10);
    const sha256 = await sha256_hex(bytes);
    let winner: Awaited<ReturnType<typeof insert_media>> | undefined;
    // The other request commits while ours is uploading, after our dedupe lookup found nothing.
    const slow_bucket = {
      ...bucket,
      put: async (...args: Parameters<typeof bucket.put>) => {
        const stored = await bucket.put(...args);
        winner = await insert_media(db, { sha256 });
        return stored;
      },
    };
    const racing = create_media({ db, bucket: slow_bucket, images: png_inspector });

    const result = await racing.ingest(stream_of(bytes), await upload_of(bytes));
    if (!result.ok) throw new Error(result.message);
    expect(result.media.id).toBe(winner!.id);
    expect(result.created).toBe(false);
    expect(bucket.objects.size).toBe(0);
  });

  test("bytes that do not match the declared hash are rejected and leave nothing", async () => {
    const bytes = png_bytes(10, 10);
    const result = await ingest(bytes, { sha256: "0".repeat(64) });
    expect(result.ok).toBe(false);
    expect(bucket.objects.size).toBe(0);
    expect(await db.select().from(Media)).toHaveLength(0);
  });

  test("a file that is not the image it claims to be is rejected and its object deleted", async () => {
    const result = await ingest(new TextEncoder().encode("not a png at all, just text"));
    expect(result).toMatchObject({ ok: false });
    expect(bucket.objects.size).toBe(0);
    expect(await db.select().from(Media)).toHaveLength(0);
  });

  test("an image whose real format differs from the claimed one is rejected", async () => {
    const result = await ingest(png_bytes(10, 10), { content_type: "image/jpeg", ext: "jpg" });
    expect(result).toMatchObject({ ok: false });
    expect(bucket.objects.size).toBe(0);
  });
});

describe("sweep_orphans", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const hours_ago = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

  async function stored_media(created_at: Date) {
    const row = await insert_media(db, { created_at });
    bucket.objects.set(`${row.id}/original.jpg`, {
      bytes: new Uint8Array(1),
      content_type: "image/jpeg",
      filename: "a.jpg",
    });
    return row;
  }

  test("removes unlinked media past the grace period, row and object", async () => {
    const old = await stored_media(hours_ago(49));

    expect(await media.sweep_orphans({ now })).toBe(1);
    expect(await db.select().from(Media)).toHaveLength(0);
    expect(bucket.objects.has(`${old.id}/original.jpg`)).toBe(false);
  });

  test("keeps recent uploads, since their article may not be saved yet", async () => {
    await stored_media(hours_ago(47));

    expect(await media.sweep_orphans({ now })).toBe(0);
    expect(await db.select().from(Media)).toHaveLength(1);
    expect(bucket.objects.size).toBe(1);
  });

  test("keeps media an article links", async () => {
    const [article] = await db.insert(Article).values({ title: "A" }).returning();
    const linked = await stored_media(hours_ago(500));
    await db
      .insert(MediaToArticles)
      .values({ article_id: article!.id, media_id: linked.id, order: 0 });

    expect(await media.sweep_orphans({ now })).toBe(0);
    expect(bucket.objects.size).toBe(1);
  });

  test("a failed object delete leaves a stray object, never a row without one", async () => {
    await stored_media(hours_ago(49));
    const failing = create_media({
      db,
      bucket: {
        ...bucket,
        delete: () => Promise.reject(new Error("R2 down")),
      },
      images: png_inspector,
    });

    await expect(failing.sweep_orphans({ now })).rejects.toThrow("R2 down");
    expect(await db.select().from(Media)).toHaveLength(0);
    expect(bucket.objects.size).toBe(1);
  });
});
