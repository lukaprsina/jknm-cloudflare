/**
 * Seeds a LOCAL database with one article per visibility case for
 * `scripts/smoke-public.ts`. Refuses anything but a local database named *smoke* or *probe*.
 * Usage: DATABASE_URL=postgres://... vpx scripts/seed-smoke.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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
  slugs: { slug: string; is_primary: boolean }[];
};
const seeds: Seed[] = [
  { title: "Published A", status: "published", slugs: [{ slug: "pub-a", is_primary: true }] },
  {
    title: "Renamed B",
    status: "published",
    slugs: [
      { slug: "renamed-b-new", is_primary: true },
      { slug: "renamed-b-old", is_primary: false },
    ],
  },
  { title: "Draft", status: "draft", slugs: [{ slug: "draft-x", is_primary: true }] },
  { title: "Archived", status: "archived", slugs: [{ slug: "archived-x", is_primary: true }] },
  { title: "Deleted", status: "deleted", slugs: [{ slug: "deleted-x", is_primary: true }] },
  {
    title: "Content page",
    status: "published",
    kind: "content",
    slugs: [{ slug: "content-x", is_primary: true }],
  },
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
