import { ChecksumMismatch, type ImageInspector, type MediaBucket } from "./ports";

export const stream_of = (bytes: Uint8Array) =>
  new Response(bytes as BodyInit).body as ReadableStream;

const bytes_of = async (stream: ReadableStream) =>
  new Uint8Array(await new Response(stream).arrayBuffer());

export const sha256_hex = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/** R2 as the tests need it: keeps bytes in a map and checks the hash on write like R2 does. */
export function memory_bucket() {
  const objects = new Map<string, { bytes: Uint8Array; content_type: string; filename: string }>();
  const bucket: MediaBucket = {
    async put(key, body, { content_type, filename, sha256 }) {
      const bytes = await bytes_of(body);
      if ((await sha256_hex(bytes)) !== sha256) throw new ChecksumMismatch();
      objects.set(key, { bytes, content_type, filename });
      return { size: bytes.length };
    },
    async get(key) {
      const object = objects.get(key);
      return object ? stream_of(object.bytes) : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return Object.assign(bucket, { objects });
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The first bytes of a PNG: signature and an IHDR with the size. Enough for `png_inspector`. */
export function png_bytes(width: number, height: number, padding = 0) {
  const bytes = new Uint8Array(24 + padding);
  const view = new DataView(bytes.buffer);
  bytes.set(PNG_SIGNATURE);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** Cloudflare Images for the tests: understands only PNG, and throws for anything else like the real one. */
export const png_inspector: ImageInspector = {
  async info(body) {
    const bytes = await bytes_of(body);
    if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
      throw new Error("not an image");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    return { content_type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  },
};
