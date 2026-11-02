import { describe, expect, test } from "vite-plus/test";
import { create_internal_gate, REVALIDATE_PATH } from "./internal-gate";

describe("internal gate", () => {
  const gate = create_internal_gate();
  const url = `https://x.test${REVALIDATE_PATH}`;

  test("allows ordinary paths", () => {
    expect(gate.allows(new Request("https://x.test/novica/a"))).toBe(true);
  });
  test("rejects internal paths without or with a wrong token", () => {
    expect(gate.allows(new Request(url))).toBe(false);
    expect(gate.allows(new Request(url, { headers: { "x-internal-token": "nope" } }))).toBe(false);
  });
  test("accepts the isolate's own token", () => {
    expect(gate.allows(new Request(url, { headers: gate.headers() }))).toBe(true);
  });
  test("tokens differ per gate", () => {
    expect(create_internal_gate().headers()).not.toEqual(gate.headers());
  });
});
