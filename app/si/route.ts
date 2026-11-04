import { legacy_gone, legacy_redirect } from "@/lib/legacy-response";
import { is_valid_legacy_id } from "@/lib/legacy-si-paths";
import { get_published } from "@/server/published";

// Do not export `revalidate`, `dynamic = "force-static"` or `generateStaticParams`: see `legacy-response`.

/**
 * Old links look like `/si/?id=<legacy_id>&l=<year>`; `l` was the archive-year
 * filter and is dropped. Never renders anything: it only redirects or is gone.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return legacy_redirect("/", 301);
  if (!is_valid_legacy_id(id)) return legacy_gone();

  const result = await get_published().by_legacy_id(Number(id));
  if (result.outcome === "not_found") return legacy_gone();
  return legacy_redirect(`/novica/${encodeURIComponent(result.slug)}`);
}
