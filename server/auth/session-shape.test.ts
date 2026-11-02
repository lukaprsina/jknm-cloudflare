import { describe, expect, test } from "vite-plus/test";
import { to_app_session } from "./session-shape";

// Hand-written fixture of what better-auth's `auth.api.getSession` returns.
const better_auth_result = {
  session: {
    expiresAt: new Date("2026-08-01T12:00:00.000Z"),
  },
  user: {
    id: "3f7c0b9e-1f42-4d0a-9f6b-2a9c1e7d55aa",
    name: "Urednik",
    email: "urednik@jknm.si",
    image: "https://lh3.googleusercontent.com/a/xyz",
  },
};

describe("to_app_session", () => {
  test("returns null when there is no session", () => {
    expect(to_app_session(null)).toBeNull();
  });

  test("preserves the user id the article foreign keys point at", () => {
    expect(to_app_session(better_auth_result)?.user.id).toBe(better_auth_result.user.id);
  });

  test("produces the app's established session shape", () => {
    expect(to_app_session(better_auth_result)).toEqual({
      user: {
        id: "3f7c0b9e-1f42-4d0a-9f6b-2a9c1e7d55aa",
        name: "Urednik",
        email: "urednik@jknm.si",
        image: "https://lh3.googleusercontent.com/a/xyz",
      },
      expires: "2026-08-01T12:00:00.000Z",
    });
  });

  test("normalises absent optional user fields to null", () => {
    const session = to_app_session({
      ...better_auth_result,
      user: { id: "u1", name: "", email: "urednik@jknm.si" },
    });

    expect(session?.user).toEqual({
      id: "u1",
      name: "",
      email: "urednik@jknm.si",
      image: null,
    });
  });
});
