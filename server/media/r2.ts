import { ChecksumMismatch, type ImageInspector, type MediaBucket } from "./ports";
import { stored_object_headers } from "./object-headers";

/** The real bucket. Checked on a deployed Worker, not in unit tests. */
export function r2_media_bucket(r2: R2Bucket): MediaBucket {
  return {
    async put(key, body, meta) {
      const headers = stored_object_headers(meta);
      try {
        const object = await r2.put(key, body, {
          sha256: meta.sha256,
          httpMetadata: {
            contentType: meta.content_type,
            cacheControl: headers.cache_control,
            contentDisposition: headers.content_disposition,
          },
          customMetadata: headers.metadata,
        });
        return { size: object.size };
      } catch (error) {
        if (error instanceof Error && /checksum|digest/i.test(error.message)) {
          throw new ChecksumMismatch();
        }
        throw error;
      }
    },
    async get(key) {
      return (await r2.get(key))?.body ?? null;
    },
    async delete(key) {
      await r2.delete(key);
    },
  };
}

export function images_inspector(images: ImagesBinding): ImageInspector {
  return {
    async info(body) {
      const info = await images.info(body);
      if (!("width" in info)) throw new Error("not a raster image");
      return { content_type: info.format, width: info.width, height: info.height };
    },
  };
}
