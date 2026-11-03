import { expect, test } from "vite-plus/test";
import { json_ld } from "./json-ld";

test("a value cannot close the script tag, and the JSON still parses back", () => {
  const out = json_ld({ headline: "</script><script>alert(1)</script>" });
  expect(out).not.toContain("<");
  expect(JSON.parse(out)).toEqual({ headline: "</script><script>alert(1)</script>" });
});
