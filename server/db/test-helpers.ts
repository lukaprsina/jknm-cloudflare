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
