import { describe, expect, it } from "vite-plus/test";
import { is_valid_legacy_id, resolve_legacy_static_path } from "./legacy-si-paths";

// One row per rule, not per URL: sub-paths prove the fallthrough, the rest prove the renames.
describe("resolve_legacy_static_path", () => {
  it.each([
    [["klub"], "/klub"],
    [["klub", "interes"], "/klub"],
    [["klub", "zgodovina", "1962"], "/zgodovina"],
    [["publikacije", "kras01"], "/publiciranje"],
    [["etc", "kontakt"], "/stik-z-nami"],
    [["etc", "iskanje"], "/arhiv"],
  ])("redirects %j to %s", (segments, path) => {
    expect(resolve_legacy_static_path(segments)).toEqual({ outcome: "redirect", path });
  });

  it.each([
    [["jame", "naj", "najgloblje.htm"]],
    [["kataster"]],
    [["etc", "clani"]],
    [["unknown-section"]],
    [[]],
  ])("marks %j as gone", (segments) => {
    expect(resolve_legacy_static_path(segments)).toEqual({ outcome: "gone" });
  });
});

describe("is_valid_legacy_id", () => {
  it.each(["0", "42", "2147483647"])("accepts %j", (id) => {
    expect(is_valid_legacy_id(id)).toBe(true);
  });

  it.each(["not-a-number", "12.5", "-1", "2147483648", ""])("rejects %j", (id) => {
    expect(is_valid_legacy_id(id)).toBe(false);
  });
});
