/**
 * Step 3 of the migration (PLAN-media): copies the listed originals from the bucket
 * snapshot into the staging directory, strips GPS from the ones that have it,
 * and measures every image. Writes `<staging>/manifest.json`, the input of
 * `upload.ts` and `build-db.ts`. Usage: vpx scripts/migrate-media/stage.ts
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { rgbaToThumbHash } from "thumbhash";
import { SNAPSHOT_DIR, STAGING_DIR, type ManifestEntry } from "./config";
import { natural_size } from "./plan";

const run = promisify(execFile);
const CONCURRENCY = 8;

interface ListEntry {
  id: string;
  ext: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  hash: string | null;
}

const sha256_of = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** exiv2 reads these; GIFs and the rest carry no EXIF. */
const HAS_EXIF = new Set(["image/jpeg", "image/png", "image/webp"]);

async function gps_keys(path: string): Promise<string[]> {
  let stdout = "";
  try {
    ({ stdout } = await run("exiv2", ["-g", "GPS", "-Pk", path]));
  } catch (error) {
    // exiv2 exits 1 (or 253) when the file has no such tags.
    if (![1, 253].includes((error as { code?: number }).code ?? 0)) throw error;
  }
  return stdout.split("\n").flatMap((line) => line.trim().split(/\s+/)[0] || []);
}

/**
 * Deletes every GPS tag (EXIF and XMP); pixels and the other tags stay as they
 * are. exiv2 cannot rewrite an XMP block over 64 KB, so that block goes whole.
 */
async function strip_gps(path: string, keys: string[]) {
  const dels = keys.flatMap((key) => ["-M", `del ${key}`]);
  try {
    await run("exiv2", [...dels, "modify", path]);
  } catch {
    await run("exiv2", ["-d", "x", "delete", path]);
    await run("exiv2", [...dels, "modify", path]);
  }
}

async function measure(path: string, scratch: string) {
  const frame = `${path}[0]`;
  const { stdout } = await run("magick", [
    "identify",
    "-format",
    "%w %h %[EXIF:Orientation]",
    frame,
  ]);
  const [width, height, orientation] = stdout.trim().split(" ").map(Number);
  // No EXIF tag leaves the third field empty: treat it as upright.
  const turned = orientation || 1;
  // `-auto-orient` bakes the rotation in, so the hash matches what is displayed.
  const rgba = join(scratch, "pixels.rgba");
  const { stdout: small } = await run("magick", [
    frame,
    "-auto-orient",
    "-resize",
    "100x100",
    "-depth",
    "8",
    "-write",
    `rgba:${rgba}`,
    "-format",
    "%w %h",
    "info:",
  ]);
  const [w, h] = small.split(" ").map(Number);
  const thumbhash = Buffer.from(rgbaToThumbHash(w, h, await readFile(rgba))).toString("base64");
  return { ...natural_size({ width, height, orientation: turned }), thumbhash };
}

async function stage(entry: ListEntry, scratch: string) {
  const name = `${entry.id}/original.${entry.ext}`;
  const source = join(SNAPSHOT_DIR, name);
  const target = join(STAGING_DIR, "files", name);

  if (!entry.hash) throw new Error(`${name}: no hash in the DB`);
  if ((await sha256_of(source)) !== entry.hash) throw new Error(`${name}: snapshot hash differs`);
  await mkdir(join(STAGING_DIR, "files", entry.id), { recursive: true });
  await copyFile(source, target);

  let stripped = false;
  if (HAS_EXIF.has(entry.content_type)) {
    const keys = await gps_keys(target);
    if (keys.length > 0) {
      await strip_gps(target, keys);
      stripped = true;
    }
    // A second opinion from another reader: exiv2 can balk at odd maker notes.
    const { stdout } = await run("magick", ["identify", "-format", "%[EXIF:GPSLatitude]", target]);
    if (stdout.trim()) throw new Error(`${name}: GPS survived`);
  }

  const image = entry.content_type.startsWith("image/")
    ? await measure(target, scratch)
    : { width: null, height: null, thumbhash: null };
  const manifest_entry: ManifestEntry = {
    id: entry.id,
    ext: entry.ext,
    filename: entry.filename,
    content_type: entry.content_type,
    size_bytes: (await stat(target)).size,
    sha256: await sha256_of(target),
    ...image,
  };
  return { manifest_entry, stripped };
}

const list: ListEntry[] = JSON.parse(await readFile(join(STAGING_DIR, "list.json"), "utf8"));
const manifest: ManifestEntry[] = [];
let stripped = 0;
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async (_, worker) => {
    const scratch = join(tmpdir(), `stage-${process.pid}-${worker}`);
    await mkdir(scratch, { recursive: true });
    for (let i = next++; i < list.length; i = next++) {
      const result = await stage(list[i], scratch);
      manifest[i] = result.manifest_entry;
      if (result.stripped) stripped++;
      if (i % 500 === 0) console.log(`${i}/${list.length}`);
    }
    await rm(scratch, { recursive: true });
  }),
);

await writeFile(join(STAGING_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));
const images = manifest.filter((entry) => entry.width !== null).length;
console.log(`${manifest.length} staged: ${images} images, ${stripped} with GPS stripped`);
