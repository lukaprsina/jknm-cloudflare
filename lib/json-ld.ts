/** JSON for a `<script type="application/ld+json">` body: `<` is escaped so no value can close the tag. */
export function json_ld(data: object) {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
