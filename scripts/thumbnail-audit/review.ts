/**
 * Step 3 of the thumbnail audit (docs/private/PLAN-thumbnail-audit.md): turns
 * `match.json` (tools/thumbnail-match/match.py) into the files the cutover and
 * the human pass need. Read-only on the database (one `READ ONLY` transaction)
 * and on the bucket download; writes only under the output directory.
 *
 *   mapping.json         per published article: which body image its card
 *                        shows and the focal point (the thing applied at cutover)
 *   delete-list.json     thumbnail media rows (and bucket prefixes) that are safe
 *                        to remove once the mapping is applied, with the
 *                        non-published articles whose pointer must be nulled
 *   flag-audit.json/.csv `uploaded_custom_thumbnail` against what the matcher
 *                        inferred
 *   review.html          the rows that need a human look (open it in a browser)
 *
 * The human answers in `decisions.json` (optional, same directory):
 *   { "<article_id>": "keep" | { "source": "<media_id>", "focal_y": 42 } }
 * "keep" leaves the article's thumbnail as it is (plain media row, centred);
 * the object form picks a source image by hand. Re-run after editing.
 *
 * Usage: vpx scripts/thumbnail-audit/review.ts --bucket ~/.backups/jknm/bucket-2026-11-06
 *          [--env .env.prod-ref] [--dir artifacts/thumbnail-audit]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Pool } from "pg";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: ".env.prod-ref" },
    dir: { type: "string", default: "artifacts/thumbnail-audit" },
    bucket: { type: "string" },
  },
});
if (!values.bucket) throw new Error("--bucket <extracted bucket snapshot> is required");
const dir = values.dir!;
const bucket = resolve(values.bucket.replace(/^~/, homedir()));

interface Candidate {
  media_id: string;
  url: string;
  inliers: number;
  zncc?: number;
  zncc_blocks?: number;
  focal_pct?: [number, number];
  rect_pct?: [number, number, number, number];
  source_size?: [number, number];
}
interface MatchEntry {
  group: "typical" | "odd_size" | "flagged_custom" | "body_crop";
  article_id: string;
  title: string;
  uploaded_custom_thumbnail: boolean | null;
  crop: { x: number | null; y: number | null; width: number | null; height: number | null };
  thumbnail: { id: string; url: string; width: number; height: number };
  candidates: Candidate[];
  verdict: "match" | "weak" | "none";
  alternates: string[];
  edited: boolean;
  runner_up_inliers: number;
}
type Decision = "keep" | { source: string; focal_y: number };

const entries = (
  JSON.parse(readFileSync(join(dir, "match.json"), "utf8")) as { entries: MatchEntry[] }
).entries;
const decisions: Record<string, Decision> = existsSync(join(dir, "decisions.json"))
  ? JSON.parse(readFileSync(join(dir, "decisions.json"), "utf8"))
  : {};

const key_of = (url: string) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
const local = (url: string) => join(bucket, key_of(url));
const round = (n: number) => Math.round(n * 100) / 100;

// --- database facts the delete list depends on -------------------------------

const line = readFileSync(values.env!, "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1];
if (!line) throw new Error(`DATABASE_URL not found in ${values.env}`);
const pool = new Pool({
  connectionString: line
    .replace(/^"|"$/g, "")
    .replace("pooler.supabase.com:6543", "pooler.supabase.com:5432"),
});
const client = await pool.connect();
await client.query("BEGIN READ ONLY");
const thumbnail_ids = [...new Set(entries.map((e) => e.thumbnail.id))];
const referencing = (
  await client.query<{ id: string; status: string; thumbnail_media_id: string }>(
    `select id, status, thumbnail_media_id from articles where thumbnail_media_id = any($1::uuid[])`,
    [thumbnail_ids],
  )
).rows;
const body_linked = new Set(
  (
    await client.query<{ media_id: string }>(
      `select distinct media_id from media_to_articles where media_id = any($1::uuid[])`,
      [thumbnail_ids],
    )
  ).rows.map((r) => r.media_id),
);
const in_content = new Set(
  (
    await client.query<{ id: string }>(
      `select m.id from unnest($1::uuid[]) as m(id)
        where exists (select 1 from articles b where b.content_json::text like '%' || m.id::text || '%')`,
      [thumbnail_ids],
    )
  ).rows.map((r) => r.id),
);
await client.query("ROLLBACK");
client.release();
await pool.end();

// --- per-article decision -----------------------------------------------------

interface Mapping {
  article_id: string;
  title: string;
  method: "match" | "crop_columns" | "human";
  source_media_id: string;
  focal_x_pct: number;
  focal_y_pct: number;
  rect_pct: [number, number, number, number] | null;
  edited: boolean;
  thumbnail_media_id: string;
}
interface Kept {
  article_id: string;
  title: string;
  thumbnail_media_id: string;
  reason: string;
}

const mapping: Mapping[] = [];
const kept: Kept[] = [];
const problems: string[] = [];

for (const e of entries) {
  const decision = decisions[e.article_id];
  const base = { article_id: e.article_id, title: e.title, thumbnail_media_id: e.thumbnail.id };
  const best = e.candidates[0];
  if (decision === "keep") {
    kept.push({ ...base, reason: "human: keep" });
  } else if (decision) {
    const known =
      e.candidates.some((c) => c.media_id === decision.source) ||
      decision.source === e.thumbnail.id;
    if (!known)
      problems.push(`decisions.json: ${decision.source} is not a candidate of ${e.article_id}`);
    mapping.push({
      ...base,
      method: "human",
      source_media_id: decision.source,
      focal_x_pct: 50,
      focal_y_pct: decision.focal_y,
      rect_pct: null,
      edited: false,
    });
  } else if (e.verdict === "match" && best?.focal_pct) {
    mapping.push({
      ...base,
      method: "match",
      source_media_id: best.media_id,
      focal_x_pct: best.focal_pct[0],
      focal_y_pct: best.focal_pct[1],
      rect_pct: best.rect_pct ?? null,
      edited: e.edited,
    });
  } else if (e.group === "body_crop" && e.crop.y !== null && e.crop.height !== null) {
    // The thumbnail is already a body image; the editor's crop columns say
    // where the author framed it (the old public side ignored them).
    mapping.push({
      ...base,
      method: "crop_columns",
      source_media_id: e.thumbnail.id,
      focal_x_pct: 50,
      focal_y_pct: round(e.crop.y + e.crop.height / 2),
      rect_pct: null,
      edited: false,
    });
  } else {
    kept.push({
      ...base,
      reason:
        e.candidates.length === 0 ? "no candidate image" : `no verified source (${e.verdict})`,
    });
  }
}

// --- delete list --------------------------------------------------------------

const mapped_by_article = new Map(mapping.map((m) => [m.article_id, m]));
const sources = new Set(mapping.map((m) => m.source_media_id));
const published_by_thumbnail = Map.groupBy(entries, (e) => e.thumbnail.id);
const referencing_by_thumbnail = Map.groupBy(referencing, (r) => r.thumbnail_media_id);

function prefix_files(url: string) {
  const prefix = join(bucket, dirname(key_of(url)));
  if (!existsSync(prefix)) return { prefix: dirname(key_of(url)), files: 0, bytes: 0 };
  const names = readdirSync(prefix);
  return {
    prefix: dirname(key_of(url)),
    files: names.length,
    bytes: names.reduce((sum, name) => sum + statSync(join(prefix, name)).size, 0),
  };
}

const deletions: unknown[] = [];
const retained: { media_id: string; reason: string }[] = [];
for (const [media_id, published] of published_by_thumbnail) {
  const reasons: string[] = [];
  for (const e of published) {
    const m = mapped_by_article.get(e.article_id);
    if (!m) reasons.push(`kept by ${e.article_id}`);
    else if (m.source_media_id === media_id) reasons.push(`is the source of ${e.article_id}`);
  }
  if (body_linked.has(media_id)) reasons.push("linked to an article as a body image");
  if (in_content.has(media_id)) reasons.push("referenced in some article's content");
  if (sources.has(media_id)) reasons.push("used as another article's source");
  if (reasons.length > 0) {
    retained.push({ media_id, reason: [...new Set(reasons)].join("; ") });
    continue;
  }
  const rows = referencing_by_thumbnail.get(media_id) ?? [];
  deletions.push({
    media_id,
    ...prefix_files(published[0]!.thumbnail.url),
    replaced_for: published.map((e) => e.article_id),
    null_out: rows
      .filter((r) => r.status !== "published")
      .map((r) => ({ id: r.id, status: r.status })),
  });
}
const deleted_bytes = (deletions as { bytes: number }[]).reduce((sum, d) => sum + d.bytes, 0);
const deleted_files = (deletions as { files: number }[]).reduce((sum, d) => sum + d.files, 0);

// --- flag audit ---------------------------------------------------------------

const audit = entries.map((e) => {
  const best = e.candidates[0];
  const matched = e.verdict === "match";
  const flag = e.uploaded_custom_thumbnail;
  const bucket_name =
    e.group === "body_crop"
      ? "body_crop"
      : flag === true && matched
        ? "flag_true_but_matched"
        : flag === false && !matched
          ? "flag_false_but_unmatched"
          : flag === null
            ? matched
              ? "null_matched"
              : "null_unmatched"
            : matched
              ? "agree_not_custom"
              : "agree_custom";
  return {
    bucket: bucket_name,
    article_id: e.article_id,
    title: e.title,
    flag,
    inferred_custom: !matched,
    verdict: e.verdict,
    inliers: best?.inliers ?? 0,
    runner_up_inliers: e.runner_up_inliers,
    zncc_blocks: best?.zncc_blocks ?? null,
    edited: e.edited,
    alternates: e.alternates.length,
    candidates: e.candidates.length,
    thumbnail: `${e.thumbnail.width}x${e.thumbnail.height}`,
    source_media_id: matched ? best!.media_id : null,
    focal_y_pct: matched ? (best!.focal_pct?.[1] ?? null) : null,
    zoomed: matched && (best!.rect_pct?.[2] ?? 100) < 97,
  };
});
const csv_cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const columns = Object.keys(audit[0]!);
writeFileSync(
  join(dir, "flag-audit.csv"),
  [
    columns.join(","),
    ...audit.map((r) => columns.map((c) => csv_cell(r[c as keyof typeof r])).join(",")),
  ].join("\n"),
);
writeFileSync(join(dir, "flag-audit.json"), JSON.stringify(audit, null, 2));
writeFileSync(join(dir, "mapping.json"), JSON.stringify(mapping, null, 2));
writeFileSync(
  join(dir, "delete-list.json"),
  JSON.stringify({ deleted_bytes, deleted_files, deletions, retained, kept }, null, 2),
);

// --- review.html --------------------------------------------------------------

const decided = new Set(Object.keys(decisions));
const review = entries.filter((e) => {
  const best = e.candidates[0];
  const m = mapped_by_article.get(e.article_id);
  return (
    !decided.has(e.article_id) &&
    (e.verdict !== "match" ||
      e.edited ||
      e.alternates.length > 0 ||
      (best?.rect_pct?.[2] ?? 100) < 97) &&
    m?.method !== "human"
  );
});
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const file_url = (p: string) => `file://${encodeURI(p)}`;
const why = (e: MatchEntry) => {
  const best = e.candidates[0];
  if (e.group === "body_crop")
    return "thumbnail is a body image; proposed focal comes from the editor's crop columns";
  if (e.candidates.length === 0) return "no candidate image in the article";
  if (e.verdict !== "match")
    return `no verified source (best: ${best?.inliers} inliers, correlation ${best?.zncc_blocks ?? "-"})`;
  if ((best?.rect_pct?.[2] ?? 100) < 97)
    return `zoomed crop (${best!.rect_pct![2]}% of the source width)`;
  if (e.alternates.length) return "matched; identical copies of the same photo exist (any is fine)";
  return "matched, but the thumbnail is edited (logo or grayscale)";
};
const rows = review.map((e) => {
  const m = mapped_by_article.get(e.article_id);
  const overlay = ["match", "weak"]
    .map((v) => resolve(dir, "overlays", `${v}-${e.article_id}.jpg`))
    .find((p) => existsSync(p));
  const candidates = e.candidates
    .map((c) => {
      const snippet = JSON.stringify({ source: c.media_id, focal_y: c.focal_pct?.[1] ?? 50 });
      return `<figure data-copy='${esc(`"${e.article_id}": ${snippet}`)}' title="click to copy a decisions.json line">
        <img loading="lazy" src="${file_url(local(c.url))}" />
        <figcaption>${c.media_id.slice(0, 8)} · ${c.inliers} inl${c.zncc_blocks !== undefined ? ` · ${c.zncc_blocks}` : ""}</figcaption></figure>`;
    })
    .join("");
  return `<section>
    <h2>${esc(e.title)} <small>${e.article_id}</small></h2>
    <p><b>${esc(why(e))}</b>${m ? ` · current plan: <code>${m.method}</code> focal y ${m.focal_y_pct}` : " · current plan: keep as is"}</p>
    <div class="row"><figure><img src="${file_url(local(e.thumbnail.url))}" /><figcaption>thumbnail ${e.thumbnail.width}×${e.thumbnail.height}</figcaption></figure>
    ${overlay ? `<figure><img class="wide" src="${file_url(overlay)}" /><figcaption>best candidate, red = where the thumbnail comes from</figcaption></figure>` : ""}</div>
    <details${e.verdict === "match" ? "" : " open"}><summary>${e.candidates.length} candidates in this article (click one to copy its decisions.json line)</summary><div class="row">${candidates}</div></details>
    <p><button data-copy='${esc(`"${e.article_id}": "keep"`)}'>copy: keep as is</button></p>
  </section>`;
});
writeFileSync(
  join(dir, "review.html"),
  `<!doctype html><meta charset="utf-8"><title>thumbnail review</title>
<style>body{font:14px system-ui;margin:1.5rem;max-width:1500px}section{border-top:2px solid #999;padding:1rem 0}
h2 small{color:#888;font-weight:400;font-size:.7em}.row{display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-start}
figure{margin:0}img{max-height:200px;display:block;background:#eee}img.wide{max-height:300px}figure[data-copy]{cursor:pointer}
figure[data-copy]:hover img{outline:3px solid #36c}figcaption{font-size:11px;color:#555}code{background:#eee;padding:0 .2em}</style>
<h1>${rows.length} thumbnails to look at</h1>
<p>For each row, decide whether the plan is right. If not, click the right candidate (or the keep button); the line goes to your clipboard. Paste lines into <code>${esc(resolve(dir, "decisions.json"))}</code> as one JSON object, then re-run review.ts. Rows you do not touch follow "current plan".</p>
${rows.join("\n")}
<script>document.addEventListener("click",e=>{const t=e.target.closest("[data-copy]");if(t){navigator.clipboard.writeText(t.dataset.copy);t.style.opacity=.5;setTimeout(()=>t.style.opacity=1,300)}})</script>`,
);

// --- summary ------------------------------------------------------------------

const count = <T>(items: T[], f: (t: T) => string) =>
  Object.fromEntries([...Map.groupBy(items, f)].map(([k, v]) => [k, v.length]));
console.log(`articles: ${entries.length}`);
console.log(
  "mapped by method:",
  count(mapping, (m) => m.method),
  `| kept as is: ${kept.length}`,
);
console.log(
  "flag audit:",
  count(audit, (a) => a.bucket),
);
console.log(
  `delete list: ${deletions.length} thumbnail media rows, ${deleted_files} objects, ${(deleted_bytes / 1e6).toFixed(1)} MB; ` +
    `retained ${retained.length} rows (still referenced)`,
);
console.log(
  `non-published articles to null out: ${(deletions as { null_out: unknown[] }[]).reduce((n, d) => n + d.null_out.length, 0)}`,
);
console.log(`review.html: ${review.length} rows`);
if (problems.length) {
  console.error("PROBLEMS:\n" + problems.join("\n"));
  process.exitCode = 1;
}
