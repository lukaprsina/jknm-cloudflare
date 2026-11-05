/**
 * Seeds a LOCAL database with one article per visibility case for
 * the seeded cases of `e2e/contract.e2e.test.ts`. Refuses anything but a local database named *smoke* or *probe*.
 * Usage: DATABASE_URL=postgres://... vpx scripts/seed-smoke.ts, then build with
 * NEXT_PUBLIC_DEPLOYMENT_ORIGIN=http://localhost:4180, `vp preview --port 4180` and run
 * E2E_URL=http://localhost:4180 SEEDED=1 vp test e2e
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CONTENT_PAGES } from "../lib/content-pages";
import * as schema from "../server/db/schema";

const url = process.env.DATABASE_URL ?? "";
// It deletes every article: only a local database named for the purpose qualifies.
if (!/@(127\.0\.0\.1|localhost):\d+\/\w*(smoke|probe)\w*$/.test(url)) {
  throw new Error(
    "seed-smoke: refusing; needs a local database whose name contains smoke or probe",
  );
}
const db = drizzle(new Pool({ connectionString: url }), { schema });

type Seed = {
  title: string;
  status: "draft" | "published" | "archived" | "deleted";
  kind?: "article" | "content";
  /** Defaults to a few days ago, older than every filler, so the feed order is fixed. */
  published_at?: Date;
  /** The id an old `/si/?id=` link carries. */
  legacy_id?: number;
  slugs: { slug: string; is_primary: boolean }[];
};
const seeds: Seed[] = [
  {
    title: "Published A",
    status: "published",
    legacy_id: 101,
    slugs: [{ slug: "pub-a", is_primary: true }],
  },
  {
    title: "Renamed B",
    status: "published",
    legacy_id: 102,
    slugs: [
      { slug: "renamed-b-new", is_primary: true },
      { slug: "renamed-b-old", is_primary: false },
    ],
  },
  {
    title: "Draft",
    status: "draft",
    legacy_id: 103,
    slugs: [{ slug: "draft-x", is_primary: true }],
  },
  {
    title: "Archived",
    status: "archived",
    legacy_id: 104,
    slugs: [{ slug: "archived-x", is_primary: true }],
  },
  { title: "Deleted", status: "deleted", slugs: [{ slug: "deleted-x", is_primary: true }] },
  {
    title: "Content page",
    status: "published",
    kind: "content",
    legacy_id: 105,
    slugs: [{ slug: "content-x", is_primary: true }],
  },
  // The five club pages, each at its fixed slug.
  ...CONTENT_PAGES.map(({ slug, title }): Seed => ({
    title,
    status: "published",
    kind: "content",
    slugs: [{ slug, is_primary: true }],
  })),
];

// Enough dated news for the homepage feed to span pages (13, then 12 each), including
// a tie on the publish date so the id tiebreak is exercised. Filler 0 is the newest.
const DAY = 86_400_000;
const filler: Seed[] = Array.from({ length: 24 }, (_, i) => ({
  title: `Filler ${i}`,
  status: "published",
  slugs: [{ slug: `filler-${i}`, is_primary: true }],
  published_at: new Date(Date.UTC(2026, 0, 1) + (24 - (i === 1 ? 0 : i)) * DAY),
}));
seeds.push(...filler);

await db.delete(schema.ArticleSlug);
await db.delete(schema.Article);
for (const s of seeds) {
  const [article] = await db
    .insert(schema.Article)
    .values({
      title: s.title,
      status: s.status,
      article_kind: s.kind ?? "article",
      legacy_id: s.legacy_id,
      published_at: s.published_at ?? new Date(Date.UTC(2025, 0, 1)),
      updated_at: new Date(),
    })
    .returning();
  await db
    .insert(schema.ArticleSlug)
    .values(s.slugs.map((x) => ({ ...x, article_id: article!.id })));
}
console.log(`seeded ${seeds.length} articles`);
process.exit(0);
