import { readPlumb } from "@/lib/spike/plumb-cached";

// Response-cacheable page that reads a tagged unstable_cache entry: does revalidateTag("plumb")
// also purge this page's cached HTML? (cf-cache-status / renderedAt tell.)
export const revalidate = 3600;

export default async function Page() {
  const v = await readPlumb();
  return <pre id="state">{JSON.stringify({ ...v, renderedAt: Date.now() })}</pre>;
}
