import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");

export default defineConfig({
  schema: "./server/db/schema.ts",
  dialect: "postgresql",
  // Direct connection, not Hyperdrive or the transaction pooler.
  dbCredentials: { url: process.env.DATABASE_URL },
});
