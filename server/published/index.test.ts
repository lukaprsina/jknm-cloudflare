import { expect, test, vi } from "vite-plus/test";
import { invalidations_for } from "@/lib/cache-policy";

const unstable_cache = vi.hoisted(() =>
  vi.fn((fn: unknown, _keys: string[], _options: { tags?: string[] }) => fn),
);
vi.mock("next/cache", () => ({ unstable_cache }));

// vinext copies the tags of every `unstable_cache` call onto the page's stored
// response, so this call is the only thing that lets `article.published` reach
// `/novica/<slug>`. Dropping the tag stops articles refreshing, silently.
test("the cached article lookup carries a tag that publishing invalidates", async () => {
  await import("./index");
  const options = unstable_cache.mock.calls[0]?.[2];
  const invalidated = invalidations_for("article.published").tags as readonly string[];
  expect(options?.tags?.some((tag) => invalidated.includes(tag))).toBe(true);
});
