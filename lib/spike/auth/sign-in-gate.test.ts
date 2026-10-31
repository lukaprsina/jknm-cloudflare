import { describe, expect, test } from "vite-plus/test";
import { is_allowed_sign_in } from "./sign-in-gate";

const valid = {
  provider: "google",
  email: "editor@jknm.si",
  email_verified: true,
};

describe("is_allowed_sign_in", () => {
  test("admits a verified @jknm.si Google account", () => {
    expect(is_allowed_sign_in(valid)).toBe(true);
  });

  test("admits regardless of address casing", () => {
    expect(is_allowed_sign_in({ ...valid, email: "Editor@JKNM.si" })).toBe(true);
  });

  test.each(["github", "credentials", ""])("rejects the %s provider", (provider) => {
    expect(is_allowed_sign_in({ ...valid, provider })).toBe(false);
  });

  test.each([false, null, undefined])("rejects email_verified = %s", (email_verified) => {
    expect(is_allowed_sign_in({ ...valid, email_verified })).toBe(false);
  });

  test.each([null, undefined, ""])("rejects a %s email", (email) => {
    expect(is_allowed_sign_in({ ...valid, email })).toBe(false);
  });

  test("rejects another domain", () => {
    expect(is_allowed_sign_in({ ...valid, email: "someone@gmail.com" })).toBe(false);
  });

  test.each([
    "someone@notjknm.si",
    "someone@jknm.si.example.com",
    "someone@sub.jknm.si",
    "jknm.si@gmail.com",
  ])("rejects the near-miss address %s", (email) => {
    expect(is_allowed_sign_in({ ...valid, email })).toBe(false);
  });
});
