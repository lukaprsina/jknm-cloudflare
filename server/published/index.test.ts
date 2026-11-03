import { expect, test, vi } from "vite-plus/test";
import { invalidations_for } from "@/lib/cache-policy";

const unstable_cache = vi.hoisted(() =>
  vi.fn((fn: unknown, _keys: string[], _options: { tags?: string[] }) => fn),
);
vi.mock("next/cache", () => ({ unstable_cache }));

// vinext copies the tags of every `unstable_cache` call onto the page's stored
// response, so these calls are the only thing that lets `article.published` reach
// `/novica/<slug>` and the club pages. Dropping a tag stops that page refreshing, silently.
await import("./index");
// Snapshot now: mocks are cleared between tests.
const cache_calls = [...unstable_cache.mock.calls];

test.each(["published-by-slug", "published-content-page"])(
  "the cached %s lookup carries a tag that publishing invalidates",
  async (key) => {
    const call = cache_calls.find(([, keys]) => keys[0] === key);
    if (!call) throw new Error(`no unstable_cache call keyed ${key}; renamed?`);
    const options = call[2];
    const invalidated = invalidations_for("article.published").tags as readonly string[];
    expect(options.tags?.some((tag) => invalidated.includes(tag))).toBe(true);
  },
);
