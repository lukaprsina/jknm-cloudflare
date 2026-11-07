/** Why a media row is not migrated. */
export type DropReason = "replaced thumbnail" | "unused";

/**
 * Splits the prod media rows into the ones that get copied and the ones left
 * behind. A row is left behind when the thumbnail audit replaced it (its
 * picture is now a body image plus a crop), or when no live article uses it.
 * `used` is every media id a live article embeds or shows as its thumbnail.
 */
export function select_media<Row extends { id: string }>({
  rows,
  replaced_thumbnails,
  used,
}: {
  rows: Row[];
  replaced_thumbnails: Set<string>;
  used: Set<string>;
}) {
  const kept: Row[] = [];
  const dropped = new Map<string, DropReason>();
  for (const row of rows) {
    if (replaced_thumbnails.has(row.id)) dropped.set(row.id, "replaced thumbnail");
    else if (!used.has(row.id)) dropped.set(row.id, "unused");
    else kept.push(row);
  }
  return { kept, dropped };
}

/**
 * The natural size (see GLOSSARY): EXIF orientations 5 to 8 are quarter turns,
 * which browsers and Cloudflare apply, so width and height swap.
 */
export function natural_size({
  width,
  height,
  orientation = 1,
}: {
  width: number;
  height: number;
  orientation?: number;
}) {
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}
