/** What may be uploaded, by type; the stored extension follows the type, never the filename. */
const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
} as const;

/** Cloudflare's request-body limit on our plan. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** A validated `PUT /api/media`: everything `create_media` needs besides the body. */
export interface Upload {
  filename: string;
  content_type: string;
  ext: string;
  length: number;
  /** Of the body; R2 verifies it on write. */
  sha256: string;
  /** Base64, for images only. */
  thumbhash: string | null;
}

export interface Rejection {
  status: 400 | 411 | 413 | 415;
  message: string;
}

export type ParsedUpload = { ok: true; upload: Upload } | { ok: false; rejection: Rejection };

const reject = (status: Rejection["status"], message: string): ParsedUpload => ({
  ok: false,
  rejection: { status, message },
});

const SHA256 = /^[0-9a-f]{64}$/;
/** A ThumbHash is 25 to 35 bytes, so at most 48 base64 characters. */
const THUMBHASH = /^[A-Za-z0-9+/]{8,64}={0,2}$/;

/**
 * Checks the upload before any byte is read. R2 needs the body length up
 * front, so `Content-Length` is required; the client sends the file's SHA-256
 * so dedupe can happen before the upload and R2 can verify the bytes.
 */
export function parse_upload_request({
  content_length,
  query,
}: {
  content_length: string | null;
  query: URLSearchParams;
}): ParsedUpload {
  const content_type = query.get("type") ?? "";
  if (!Object.hasOwn(ALLOWED_TYPES, content_type)) {
    return reject(415, "Ta vrsta datoteke ni dovoljena.");
  }
  const ext = ALLOWED_TYPES[content_type as keyof typeof ALLOWED_TYPES];
  const is_image = content_type.startsWith("image/");

  if (content_length === null) return reject(411, "Manjka velikost datoteke.");
  if (!/^[1-9]\d*$/.test(content_length)) return reject(400, "Neveljavna velikost datoteke.");
  const length = Number(content_length);
  if (is_image && length > MAX_IMAGE_BYTES)
    return reject(413, "Slika je prevelika (največ 20 MB).");
  if (length > MAX_FILE_BYTES) return reject(413, "Datoteka je prevelika (največ 100 MB).");

  const sha256 = query.get("sha256") ?? "";
  if (!SHA256.test(sha256)) return reject(400, "Neveljaven povzetek datoteke.");

  const filename = (query.get("filename") ?? "").trim();
  if (filename === "" || filename.length > 255) return reject(400, "Neveljavno ime datoteke.");

  const thumbhash = is_image ? query.get("thumbhash") : null;
  if (thumbhash !== null && !THUMBHASH.test(thumbhash)) {
    return reject(400, "Neveljaven predogled slike.");
  }

  return { ok: true, upload: { filename, content_type, ext, length, sha256, thumbhash } };
}
