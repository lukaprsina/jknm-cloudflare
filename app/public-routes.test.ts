import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";

/**
 * ADR-0001: public routes never read the session, because that makes a render
 * dynamic and uncacheable. This holds for the whole render, so the check walks
 * the import graph from the public entry files instead of linting one file.
 */
const root = resolve(import.meta.dirname, "..");
const FORBIDDEN = ["server/auth/session", "next/headers"];

const public_entries = [
  "app/layout.tsx",
  ...globSync("app/(site)/**/{page,layout,route}.{ts,tsx}", { cwd: root }),
  ...globSync("components/shell/*.tsx", { cwd: root }),
];

function resolve_local(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/")
    ? resolve(root, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(resolve(root, from)), specifier)
      : undefined;
  if (!base) return undefined;
  const candidates = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext);
  return candidates
    .find((path) => existsSync(path) && !path.endsWith(".svg"))
    ?.slice(root.length + 1);
}

function violations(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const queue = [entry];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(resolve(root, file), "utf8");
    for (const [, specifier] of source.matchAll(/(?:\bfrom|\bimport\(?)\s*["']([^"']+)["']/g)) {
      if (FORBIDDEN.some((name) => specifier === name || specifier.endsWith(`/${name}`)))
        found.push(`${file} imports ${specifier}`);
      const local = resolve_local(file, specifier);
      if (local && /\.tsx?$/.test(local)) queue.push(local);
    }
  }
  return found;
}

describe("public routes", () => {
  test("the public entry files were found", () => {
    expect(public_entries.length).toBeGreaterThan(5);
  });

  test.each(public_entries)("%s never reaches the session", (entry) => {
    expect(violations(entry)).toEqual([]);
  });

  // Without it vinext never stores a dynamic route's responses.
  test.each(public_entries.filter((entry) => entry.includes("[") && entry.endsWith("page.tsx")))(
    "%s exports generateStaticParams",
    (entry) => {
      expect(readFileSync(resolve(root, entry), "utf8")).toMatch(
        /export (const|function|async function) generateStaticParams\b/,
      );
    },
  );
});
