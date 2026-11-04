import { legacy_gone, legacy_redirect } from "@/lib/legacy-response";
import { resolve_legacy_static_path } from "@/lib/legacy-si-paths";

// Do not export `revalidate`, `dynamic = "force-static"` or `generateStaticParams`: see `legacy-response`.

/** The old static section tree (`/si/klub/...`); `/si` itself is `../route.ts`, since this needs a segment. */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolution = resolve_legacy_static_path((await params).path);
  return resolution.outcome === "gone" ? legacy_gone() : legacy_redirect(resolution.path);
}
