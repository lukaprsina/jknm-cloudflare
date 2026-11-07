/**
 * Checks a served bucket against `manifest.json`: every object answers 200 with
 * the stored type, size and cache headers (files also a Content-Disposition),
 * and a random sample's bytes hash to the manifest's `sha256`.
 * Usage: BASE=https://media-staging.jknm.org vpx scripts/migrate-media/verify.ts
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STAGING_DIR, type ManifestEntry } from "./config";

const base = process.env.BASE;
if (!base) throw new Error("Missing BASE");
const SAMPLE = 200;
const CONCURRENCY = 16;

const manifest: ManifestEntry[] = JSON.parse(
  await readFile(join(STAGING_DIR, "manifest.json"), "utf8"),
);
const sample = new Set(
  [...manifest]
    .sort(() => Math.random() - 0.5)
    .slice(0, SAMPLE)
    .map((entry) => entry.id),
);

async function problems(entry: ManifestEntry) {
  const url = `${base}/${entry.id}/original.${entry.ext}`;
  const found: string[] = [];
  const response = await fetch(url, { method: sample.has(entry.id) ? "GET" : "HEAD" });
  if (response.status !== 200) return [`status ${response.status}`];
  const header = (name: string) => response.headers.get(name) ?? "";
  if (header("content-type") !== entry.content_type) found.push(`type ${header("content-type")}`);
  if (header("content-length") !== String(entry.size_bytes)) found.push("size");
  if (header("cache-control") !== "public, max-age=31536000, immutable") found.push("cache");
  const is_image = entry.content_type.startsWith("image/");
  if (!is_image && !header("content-disposition").includes("filename*=UTF-8''")) {
    found.push("disposition");
  }
  if (sample.has(entry.id)) {
    const hash = createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
    if (hash !== entry.sha256) found.push("sha256");
  }
  return found;
}

let failed = 0;
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let i = next++; i < manifest.length; i = next++) {
      const found = await problems(manifest[i]).catch((error) => [String(error)]);
      if (found.length > 0) {
        failed++;
        console.log(`${manifest[i].id}: ${found.join(", ")}`);
      }
    }
  }),
);
console.log(`${manifest.length} checked (${SAMPLE} hashed), ${failed} with problems`);
process.exitCode = failed > 0 ? 1 : 0;
