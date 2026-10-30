"use client";
// SPIKE: in-browser restore + search benchmark. ?format=json|seqproto|chunked&run=1
import { useEffect, useState } from "react";
import { search, load, loadAsync, parseChunked } from "zbsearch";
import { tokenizer as tokComp } from "zbsearch/components";
import { stemmer, language } from "@zbsearch/stemmers/slovenian";
import { makeDb } from "@/lib/spike-search/schema";

const mem = () => (performance as any).memory?.usedJSHeapSize ?? null;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

export async function runBench(format: string) {
  const res: Record<string, any> = {
    format,
    ua: navigator.userAgent,
    hw: navigator.hardwareConcurrency,
  };
  const longTasks: number[] = [];
  const po = new PerformanceObserver((l) =>
    l.getEntries().forEach((x) => longTasks.push(Math.round(x.duration))),
  );
  try {
    po.observe({ entryTypes: ["longtask"] });
  } catch {}

  const man: any = await (
    await fetch(`/spike-search/manifest?format=${format}`, { cache: "no-store" })
  ).json();
  res.manifest = man;
  const h0 = mem();
  let t = performance.now();
  const idq = new URLSearchParams(location.search).get("identity") ? "?identity=1" : "";
  const r = await fetch(`/spike-search/artifact/${man.key.replace("search/", "")}${idq}`, {
    cache: "no-store",
  });
  res.headers = {
    "content-encoding": r.headers.get("content-encoding"),
    "content-type": r.headers.get("content-type"),
    "cache-control": r.headers.get("cache-control"),
  };
  const body = format === "seqproto" ? await r.arrayBuffer() : await r.text();
  res.fetchMs = Math.round(performance.now() - t);
  res.bodyLen = format === "seqproto" ? (body as ArrayBuffer).byteLength : (body as string).length;
  const rt = performance
    .getEntriesByType("resource")
    .filter((x) => x.name.includes("/artifact/"))
    .at(-1) as PerformanceResourceTiming | undefined;
  res.resource = rt && {
    encoded: rt.encodedBodySize,
    decoded: rt.decodedBodySize,
    transfer: rt.transferSize,
  };

  let db: any;
  t = performance.now();
  try {
    if (format === "seqproto") {
      const { restore } = await import("@zbsearch/plugin-data-persistence");
      db = await restore("seqproto", body as ArrayBuffer);
      res.restoreMs = Math.round(performance.now() - t);
      db.tokenizer = tokComp.createTokenizer({ stemming: true, stemmer, language });
    } else if (format === "chunked") {
      db = makeDb({ stripBody: true });
      await loadAsync(db, parseChunked(body as string));
      res.restoreMs = Math.round(performance.now() - t);
    } else {
      db = makeDb({ stripBody: true });
      const raw = JSON.parse(body as string);
      res.parseMs = Math.round(performance.now() - t);
      load(db, raw);
      res.restoreMs = Math.round(performance.now() - t);
    }
  } catch (err) {
    res.restoreError = String(err);
    po.disconnect();
    return res;
  }
  res.heapDeltaMB = h0 == null ? null : +(((mem() ?? 0) - h0) / 1e6).toFixed(1);
  res.longTasksDuringLoad = [...longTasks];

  const base = { properties: ["title", "body"], limit: 15 };
  const battery: Record<string, any> = {
    plain_jama: { ...base, term: "jama" },
    inflected_jame: { ...base, term: "jame" },
    facets: { ...base, term: "jama", facets: { author_ids: { limit: 100 }, year: {} } },
    sort_pub_desc: { ...base, term: "jama", sortBy: { property: "published_at", order: "DESC" } },
    sort_pub_asc: { ...base, term: "jama", sortBy: { property: "published_at", order: "ASC" } },
    sort_title_asc: { ...base, term: "jama", sortBy: { property: "title", order: "ASC" } },
    sort_title_desc: { ...base, term: "jama", sortBy: { property: "title", order: "DESC" } },
    sort_author_asc: { ...base, term: "jama", sortBy: { property: "author", order: "ASC" } },
    sort_author_desc: { ...base, term: "jama", sortBy: { property: "author", order: "DESC" } },
    tolerance1: { ...base, term: "jamma", tolerance: 1 },
    where_kind: { ...base, term: "jama", where: { article_kind: { eq: "article" } } },
    page2: { ...base, term: "jama", offset: 15 },
    all_facets_sorted: {
      ...base,
      term: "",
      sortBy: { property: "published_at", order: "DESC" },
      facets: { author_ids: { limit: 100 }, year: {} },
    },
    combo: {
      ...base,
      term: "jame",
      tolerance: 1,
      where: { article_kind: { eq: "article" } },
      facets: { author_ids: { limit: 100 }, year: {} },
      sortBy: { property: "title", order: "ASC" },
    },
  };
  res.queries = {};
  for (const [name, p] of Object.entries(battery)) {
    try {
      const first = performance.now();
      const o: any = await search(db, p);
      const firstMs = performance.now() - first;
      const times: number[] = [];
      for (let i = 0; i < 15; i++) {
        const s = performance.now();
        await search(db, p);
        times.push(performance.now() - s);
      }
      res.queries[name] = {
        count: o.count,
        firstMs: +firstMs.toFixed(1),
        medianMs: +median(times).toFixed(2),
        top: o.hits[0]?.document?.title?.slice(0, 30),
      };
    } catch (err) {
      res.queries[name] = { error: String(err).slice(0, 80) };
    }
  }
  res.longTasksTotal = [...longTasks];
  res.heapAfterMB = mem() == null ? null : +(mem() / 1e6).toFixed(1);
  po.disconnect();
  return res;
}

export function Bench() {
  const [out, setOut] = useState("idle");
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("run") !== "1") return;
    runBench(q.get("format") ?? "json").then(
      (r) => {
        (window as any).__spike = r;
        setOut(JSON.stringify(r, null, 1));
      },
      (e) => setOut("ERR " + e),
    );
  }, []);
  return (
    <pre id="out" style={{ fontSize: 11 }}>
      {out}
    </pre>
  );
}
