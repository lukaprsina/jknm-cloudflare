/** The narrow part of R2 that media uses; see `r2.ts` for the real one and `test-adapters.ts` for the in-memory one. */
export interface MediaBucket {
  /** Rejects with `ChecksumMismatch` when the body does not hash to `sha256`. */
  put(
    key: string,
    body: ReadableStream,
    meta: { content_type: string; filename: string; sha256: string },
  ): Promise<{ size: number }>;
  get(key: string): Promise<ReadableStream | null>;
  delete(key: string): Promise<void>;
}

export class ChecksumMismatch extends Error {
  constructor() {
    super("The uploaded bytes do not match the given SHA-256.");
  }
}

/** What Cloudflare Images reports about an image; rejects for anything that is not one. */
export interface ImageInspector {
  info(body: ReadableStream): Promise<{ content_type: string; width: number; height: number }>;
}
