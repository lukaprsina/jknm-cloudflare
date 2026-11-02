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
