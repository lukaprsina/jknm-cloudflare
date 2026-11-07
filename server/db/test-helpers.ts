import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "./index";
import * as schema from "./schema";

/** In-memory Postgres (pglite) with the schema pushed, for tests that need real query behaviour. */
export async function create_test_db(): Promise<Db> {
  const database = drizzle(new PGlite(), { schema });
  const { apply } = await pushSchema(
    schema,
    database as unknown as Parameters<typeof pushSchema>[1],
  );
  await apply();
  return database;
}

/** A `media` row for tests: a 1x1 JPEG unless `overrides` say otherwise. Returns the row and its stored URL. */
export async function insert_media(
  db: Db,
  overrides: Partial<typeof schema.Media.$inferInsert> = {},
) {
  const id = overrides.id ?? crypto.randomUUID();
  const [media] = await db
    .insert(schema.Media)
    .values({
      id,
      ext: "jpg",
      filename: "naslovna.jpg",
      content_type: "image/jpeg",
      size_bytes: 1,
      sha256: id.replaceAll("-", "").padEnd(64, "0"),
      width: 1,
      height: 1,
      ...overrides,
    })
    .returning();
  return { ...media!, url: `https://gradivo.jknm.org/${id}/original.${media!.ext}` };
}
