// SPIKE (spike/search-local): search projection + index builder. Runtime-neutral
// (no node: imports) so it runs in Node scripts, workerd and the browser.
import { create, insert, type AnyDocument } from "zbsearch";
import { documentsStore as baseStore } from "zbsearch/components";
import { language, stemmer } from "@zbsearch/stemmers/slovenian";
import { decode } from "html-entities";

export const SCHEMA = {
  title: "string",
  body: "string",
  author: "string", // "Priimek, Ime" of first author: sort key + searchable
  author_ids: "string[]", // facet (multi-valued)
  year: "string", // facet / histogram
  published_at: "number", // sort + filter
  article_kind: "enum", // 'article' | 'content'
} as const;

export interface CorpusRow {
  id: string;
  title: string;
  kind: "article" | "content";
  slug: string;
  published_at: number;
  has_thumbnail: boolean;
  authors: { id: number; first: string; last: string }[];
  blocks: string[]; // raw EditorJS block html (paragraph/list/quote already filtered)
  text_ref?: string;
}

export function htmlToText(html: string) {
  // Runtime-neutral replacement for sanitize-html(allowedTags: []) + decode + trim.
  return decode(html.replace(/<[^>]*>/g, "")).trim();
}

export function projectRow(r: CorpusRow) {
  const first = r.authors.at(0);
  const d = new Date(r.published_at);
  return {
    title: r.title,
    body: r.blocks.map(htmlToText).join("\n"),
    author: first ? `${first.last}, ${first.first}` : "",
    author_ids: r.authors.map((a) => String(a.id)),
    year: String(d.getUTCFullYear()),
    published_at: r.published_at,
    article_kind: r.kind,
    // display-only (not in SCHEMA, stored in docs store):
    slug: r.slug,
    thumb: r.has_thumbnail ? "1" : "",
  };
}

export type BuildOpts = { stripBody?: boolean; stemming?: boolean };

/** Create an empty db with the same tokenizer config the client must use. */
export function makeDb(opts: BuildOpts = {}) {
  const stemming = opts.stemming ?? true;
  return create({
    schema: SCHEMA,
    components: {
      tokenizer: stemming ? { stemming: true, stemmer, language } : { language },
      ...(opts.stripBody
        ? {
            documentsStore: {
              ...baseStore,
              store(s: any, id: any, internalId: any, doc: AnyDocument) {
                const { body: _drop, ...rest } = doc as any;
                return baseStore.store(s, id, internalId, rest);
              },
            },
          }
        : {}),
    } as any,
  });
}

export function buildDb(rows: CorpusRow[], opts: BuildOpts = {}) {
  const db = makeDb(opts);
  for (const r of rows) insert(db, projectRow(r) as any);
  return db;
}

export function scaleRows(rows: CorpusRow[], scale: number, mode: string): CorpusRow[] {
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
