// SPIKE: the ONLY module (with the routes) importing "cloudflare:workers".
import { env } from "cloudflare:workers";
import { save, stringifyChunked } from "zbsearch";
import { buildDb, type CorpusRow } from "./schema";

type E = { SEARCH_R2: R2Bucket; SPIKE_TOKEN?: string };
export const e = () => env as unknown as E;

export function guard(req: Request): Response | null {
  const t = e().SPIKE_TOKEN;
  if (!t || req.headers.get("x-spike-token") !== t) return new Response("nope", { status: 404 });
  return null;
}

function scaleRows(rows: CorpusRow[], scale: number, mode: string): CorpusRow[] {
  if (scale <= 1) return rows;
  const out = [...rows];
  for (let k = 1; k < scale; k++) {
    for (const r of rows) {
      out.push({
        ...r,
        id: `${r.id}#${k}`,
        // "uniq": suffix every word so the vocabulary (radix tree) grows too, not just postings.
        blocks:
          mode === "uniq"
            ? r.blocks.map((b) => b.replace(/(\p{L}{3,})/gu, `$1${k.toString(36)}`))
            : r.blocks,
      });
    }
  }
  return out;
}

const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function brotli(bytes: Uint8Array, how: string, quality: number): Promise<Uint8Array> {
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
  const t0 = Date.now();

  const obj = await e().SEARCH_R2.get("corpus.json");
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
  out.brotliBytes = packed.length;
  if (phase === "compress" || !put) return out;

  const hash = hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource)).slice(0, 16);
  const key = `search/${format}-${hash}`;
  await e().SEARCH_R2.put(key, packed, {
    httpMetadata: {
      contentType:
        format === "json" || format === "chunked" ? "application/json" : "application/octet-stream",
      contentEncoding: "br",
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
