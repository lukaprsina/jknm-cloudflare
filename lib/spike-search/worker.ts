// SPIKE: the ONLY module (with the routes) importing "cloudflare:workers".
import { env } from "cloudflare:workers";
import { save, stringifyChunked } from "zbsearch";
import { buildDb, scaleRows, type CorpusRow } from "./schema";

type E = { SEARCH_R2: R2Bucket; SPIKE_TOKEN?: string };
export const e = () => env as unknown as E;

export function guard(req: Request): Response | null {
  const t = e().SPIKE_TOKEN;
  if (!t || req.headers.get("x-spike-token") !== t) return new Response("nope", { status: 404 });
  return null;
}

const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function brotli(bytes: Uint8Array, how: string, quality: number): Promise<Uint8Array> {
  if (how === "none") return bytes;
  if (how === "gzip" || how === "cs-brotli") {
    const cs = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(
        new CompressionStream((how === "gzip" ? "gzip" : "brotli") as CompressionFormat),
      );
    return new Uint8Array(await new Response(cs).arrayBuffer());
  }
  if (how === "cs") {
    const cs = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream("brotli" as CompressionFormat));
    return new Uint8Array(await new Response(cs).arrayBuffer());
  }
  const z = await import("node:zlib");
  return new Uint8Array(
    z.brotliCompressSync(bytes, {
      params: {
        [z.constants.BROTLI_PARAM_QUALITY]: quality,
        [z.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    }),
  );
}

export async function runBuild(url: URL) {
  const p = url.searchParams;
  const phase = p.get("phase") ?? "all"; // load | build | persist | compress | all
  const scale = Number(p.get("scale") ?? 1);
  const format = p.get("format") ?? "json";
  const how = p.get("compress") ?? "zlib";
  const q = Number(p.get("q") ?? 11);
  const stripBody = p.get("strip") !== "0";
  const put = p.get("put") !== "0";
  const out: Record<string, unknown> = { phase, scale, format, how, q, stripBody };
  out.memUsage =
    typeof process?.memoryUsage === "function"
      ? (() => {
          try {
            return process.memoryUsage().heapUsed;
          } catch (err) {
            return String(err);
          }
        })()
      : "n/a";
  const t0 = Date.now();

  if (phase === "brotli") {
    // compress-only probe: bytes of an R2 object in, sizes out
    const raw = new Uint8Array(
      await (await e().SEARCH_R2.get(p.get("corpus") ?? "raw.json"))!.arrayBuffer(),
    );
    const packed = await brotli(raw, how, q);
    return { ...out, rawBytes: raw.length, compressedBytes: packed.length };
  }
  const obj = await e().SEARCH_R2.get(p.get("corpus") ?? "corpus.json");
  if (!obj) return { error: "no corpus" };
  let rows = (await obj.json()) as CorpusRow[];
  rows = scaleRows(rows, scale, p.get("mode") ?? "uniq");
  out.rows = rows.length;
  if (phase === "load") return out;

  const db = buildDb(rows, { stripBody });
  if (phase === "build") return out;

  let bytes: Uint8Array;
  if (format === "seqproto") {
    const { persist } = await import("@zbsearch/plugin-data-persistence");
    bytes = new Uint8Array((await persist(db, "seqproto")) as ArrayBuffer);
  } else if (format === "chunked") {
    bytes = new TextEncoder().encode(stringifyChunked(save(db, { format: "chunked" }) as any));
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(save(db)));
  }
  out.rawBytes = bytes.length;
  if (phase === "persist") return out;

  const packed = await brotli(bytes, how, q);
  out.brotliBytes = packed.length; // = compressed bytes for the chosen `how`
  if (phase === "compress" || !put) return out;

  const hash = hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource)).slice(0, 16);
  const key = `search/${format}-${hash}${p.get("suffix") ?? ""}`;
  await e().SEARCH_R2.put(key, packed, {
    httpMetadata: {
      contentType:
        format === "json" || format === "chunked" ? "application/json" : "application/octet-stream",
      ...(how === "none" ? {} : { contentEncoding: how === "gzip" ? "gzip" : "br" }),
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  const manifest = {
    key,
    format,
    rawBytes: bytes.length,
    brotliBytes: packed.length,
    count: rows.length,
  };
  await e().SEARCH_R2.put(`search/manifest-${format}.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=60" },
  });
  out.manifest = manifest;
  out.wallMsMeasured = Date.now() - t0; // meaningless for CPU in prod
  return out;
}
