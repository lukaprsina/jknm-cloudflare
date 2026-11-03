/**
 * The only author fields allowed to cross a server-to-client boundary. Email,
 * google id, image and user id are internal identity data. An explicit
 * allowlist rather than a projection of the row type, so adding a column never
 * leaks it by default.
 */
export interface PublicAuthor {
  id: number;
  author_type: "member" | "guest";
  first_name: string;
  last_name: string;
}

/** The Drizzle `columns` projection matching `PublicAuthor`. */
export const PUBLIC_AUTHOR_COLUMNS = {
  id: true,
  author_type: true,
  first_name: true,
  last_name: true,
} as const;

/** A `PublicAuthor` with the name as the site prints it. */
export type PublicAuthorView = PublicAuthor & { display_name: string };

/**
 * The one place that turns an author row into what a public page may show.
 * Fields are picked by name, so a row carrying extra columns cannot leak them
 * even if a query forgets to narrow with `PUBLIC_AUTHOR_COLUMNS`.
 */
export function to_public_author(author: PublicAuthor): PublicAuthorView {
  return {
    id: author.id,
    author_type: author.author_type,
    first_name: author.first_name,
    last_name: author.last_name,
    display_name: `${author.first_name} ${author.last_name}`,
  };
}
