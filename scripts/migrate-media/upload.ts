/**
 * Step 4 of the migration (PLAN-media): uploads the staged files to the R2 bucket
 * over the S3 API. R2 checks each body against its SHA-256 on write, and a
 * rerun skips objects already stored with the same hash.
 *
 * Usage: R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com R2_BUCKET=… \
 *        R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… vpx scripts/migrate-media/upload.ts
 * Optional: LIMIT=n uploads only the first n files (a trial run).
 */
import {
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stored_object_headers } from "../../server/media/object-headers";
import { STAGING_DIR, type ManifestEntry } from "./config";

const CONCURRENCY = 8;

function need(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const bucket = need("R2_BUCKET");
const client = new S3Client({
  region: "auto",
  endpoint: need("R2_ENDPOINT"),
  forcePathStyle: true,
  credentials: {
    accessKeyId: need("R2_ACCESS_KEY_ID"),
    secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
  },
});

async function already_stored(key: string, sha256: string) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.Metadata?.sha256 === sha256;
  } catch (error) {
    if (error instanceof NotFound || error instanceof NoSuchKey) return false;
    throw error;
  }
}

/** Returns true when it uploaded, false when the object was already there. */
async function upload(entry: ManifestEntry) {
  const key = `${entry.id}/original.${entry.ext}`;
  if (await already_stored(key, entry.sha256)) return false;
  const headers = stored_object_headers(entry);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: await readFile(join(STAGING_DIR, "files", key)),
      ContentType: entry.content_type,
      CacheControl: headers.cache_control,
      ContentDisposition: headers.content_disposition,
      ChecksumSHA256: Buffer.from(entry.sha256, "hex").toString("base64"),
      Metadata: headers.metadata,
    }),
  );
  return true;
}

const manifest: ManifestEntry[] = JSON.parse(
  await readFile(join(STAGING_DIR, "manifest.json"), "utf8"),
).slice(0, Number(process.env.LIMIT) || undefined);

let uploaded = 0;
let skipped = 0;
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let i = next++; i < manifest.length; i = next++) {
      if (await upload(manifest[i])) uploaded++;
      else skipped++;
      if ((uploaded + skipped) % 500 === 0) console.log(`${uploaded + skipped}/${manifest.length}`);
    }
  }),
);
console.log(`${uploaded} uploaded, ${skipped} already there`);
