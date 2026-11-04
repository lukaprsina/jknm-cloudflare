import { describe, expect, it } from "vite-plus/test";
import { is_valid_legacy_id, resolve_legacy_static_path } from "./legacy-si-paths";

describe("resolve_legacy_static_path", () => {
  it.each([
    [["klub"], "/klub"],
    [["klub", "interes"], "/klub"],
    [["klub", "povezave"], "/klub"],
    [["klub", "zgodovina"], "/zgodovina"],
    [["klub", "zgodovina", "1962"], "/zgodovina"],
    [["publikacije"], "/publiciranje"],
    [["publikacije", "kras01"], "/publiciranje"],
    [["raziskovanje"], "/raziskovanje"],
    [["raziskovanje", "kanin"], "/raziskovanje"],
    [["varstvo"], "/varstvo"],
    [["etc", "kontakt"], "/stik-z-nami"],
    [["etc", "iskanje"], "/arhiv"],
  ])("redirects %j to %s", (segments, path) => {
    expect(resolve_legacy_static_path(segments)).toEqual({
      outcome: "redirect",
      path,
    });
  });

  it.each([
    [["jame"]],
    [["jame", "naj", "najgloblje.htm"]],
    [["kataster"]],
    [["kataster", "jknm"]],
    [["jrs"]],
    [["izobrazevanje"]],
    [["navodila"]],
    [["download"]],
    [["etc", "clani"]],
    [["etc", "impresum"]],
    [["varnost", "piskotki"]],
    [["unknown-section"]],
    [[]],
  ])("marks %j as gone", (segments) => {
    expect(resolve_legacy_static_path(segments)).toEqual({ outcome: "gone" });
  });
});

describe("is_valid_legacy_id", () => {
  it.each([["0"], ["1"], ["42"], ["2147483647"]])("accepts %j", (id) => {
    expect(is_valid_legacy_id(id)).toBe(true);
  });

  it.each([["not-a-number"], ["12.5"], ["-1"], ["2147483648"], [""]])("rejects %j", (id) => {
    expect(is_valid_legacy_id(id)).toBe(false);
  });
});
