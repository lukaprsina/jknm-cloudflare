import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const probe = pgTable("spike_hyperdrive_probe", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  counter: integer("counter").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plumbLog = pgTable("spike_plumb_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull(),
  detail: text("detail").notNull().default(""),
});
