import { homedir } from "node:os";
import { join } from "node:path";

const backups = join(homedir(), ".backups/jknm");

/** Where the migration reads and writes. Override with the environment. */
export const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? join(backups, "bucket-2026-11-06");
export const AUDIT_DIR = process.env.AUDIT_DIR ?? join(backups, "thumbnail-audit-2026-11-06");
export const STAGING_DIR = process.env.STAGING_DIR ?? join(backups, "media-staging");

/** The prod DB (a restored dump) the list and the new DB are built from. */
export const OLD_DATABASE_URL =
  process.env.OLD_DATABASE_URL ?? "postgres://postgres:pw@localhost:55432/old";

/** One migrated file, as `stage.ts` leaves it in `manifest.json`. */
export interface ManifestEntry {
  id: string;
  ext: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  /** Natural size: stored pixels after EXIF rotation; null for files that are not images. */
  width: number | null;
  height: number | null;
  thumbhash: string | null;
}
