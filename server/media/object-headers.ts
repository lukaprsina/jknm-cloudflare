/**
 * The headers and metadata every stored object carries. Shared by the Worker's
 * upload and the migration's `upload.ts`, so both write the same thing.
 */
export function stored_object_headers({
  content_type,
  filename,
  sha256,
}: {
  content_type: string;
  filename: string;
  sha256: string;
}) {
  // RFC 5987 leaves ' ( ) * unescaped in encodeURIComponent's output; escape them too.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return {
    cache_control: "public, max-age=31536000, immutable",
    /** Files open in the browser under their own name; images need none. */
    content_disposition: content_type.startsWith("image/")
      ? undefined
      : `inline; filename*=UTF-8''${encoded}`,
    /** S3-style metadata is ASCII, so the filename is percent-encoded. */
    metadata: { sha256, filename: encoded },
  };
}
