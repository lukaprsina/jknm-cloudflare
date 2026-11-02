import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { Author } from "../db/schema";
import type { Emit } from "../events";

/**
 * Guest authors. Members are mirrored from the club's Google directory by a
 * separate sync and are never edited here, so every mutation is scoped to
 * `author_type = 'guest'`.
 */
export function create_authors({ db, emit }: { db: Db; emit: Emit }) {
  return {
    async add_guest(input: { first_name: string; last_name: string }) {
      const [guest] = await db
        .insert(Author)
        .values({ author_type: "guest", first_name: input.first_name, last_name: input.last_name })
        .returning();
      if (!guest) throw new Error("Guest was not created");
      await emit("author.inserted");
      return guest;
    },

    async rename_guest(input: { id: number; first_name: string; last_name: string }) {
      const [guest] = await db
        .update(Author)
        .set({ first_name: input.first_name, last_name: input.last_name })
        .where(and(eq(Author.id, input.id), eq(Author.author_type, "guest")))
        .returning();
      if (!guest) throw new Error("Guest author not found");
      await emit("author.renamed");
      return guest;
    },

    /** Removes the guests from every article they are credited on. */
    async delete_guests(input: { ids: number[] }) {
      const deleted = await db
        .delete(Author)
        .where(and(eq(Author.author_type, "guest"), inArray(Author.id, input.ids)))
        .returning();
      await emit("author.deleted");
      return deleted;
    },
  };
}
