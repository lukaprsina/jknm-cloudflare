import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import type { Session } from "./auth/session-shape";
import { create_action } from "./create-action";

const session: Session = {
  user: { id: "u1", name: "Urednik", email: "urednik@jknm.si", image: null },
  expires: "2026-12-01T00:00:00.000Z",
};

const schema = z.object({ title: z.string().trim().min(1) });

afterEach(() => vi.restoreAllMocks());

describe("action", () => {
  test("runs the handler with the parsed input and the session", async () => {
    const action = create_action(async () => session);
    const handler = vi.fn(async (input: { title: string }, s: Session) => ({
      echoed: input.title,
      by: s.user.id,
    }));

    const result = await action(schema, handler)({ title: "  Jama  " });

    expect(result).toEqual({ ok: true, data: { echoed: "Jama", by: "u1" } });
  });

  test("turns away a caller without a session before parsing or running anything", async () => {
    const action = create_action(async () => null);
    const handler = vi.fn(async () => "never");

    const result = await action(schema, handler)({ title: "" });

    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(handler).not.toHaveBeenCalled();
  });

  test("reports invalid input per field and does not run the handler", async () => {
    const action = create_action(async () => session);
    const handler = vi.fn(async () => "never");

    const result = await action(schema, handler)({ title: "   " });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
    if (result.ok) throw new Error("unreachable");
    expect(result.error.fields?.title?.length).toBeGreaterThan(0);
    expect(handler).not.toHaveBeenCalled();
  });

  test("hides what a failing handler or session read threw, and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "connection to db.xqkspahgpoeutngajdvm.supabase.co refused";

    const throwing = create_action(async () => session)(schema, async () => {
      throw new Error(secret);
    });
    const broken_session = create_action(async () => {
      throw new Error(secret);
    })(schema, async () => "never");

    for (const result of [await throwing({ title: "x" }), await broken_session({ title: "x" })]) {
      expect(result).toMatchObject({ ok: false, error: { code: "failed" } });
      expect(JSON.stringify(result)).not.toContain("supabase");
    }
    expect(log).toHaveBeenCalledTimes(2);
  });

  test("the result is plain data, safe across the Server Action boundary", async () => {
    const ok = await create_action(async () => session)(schema, async () => ({ n: 1 }))({
      title: "x",
    });
    const bad = await create_action(async () => null)(schema, async () => 1)({ title: "x" });

    expect(JSON.parse(JSON.stringify(ok))).toEqual(ok);
    expect(JSON.parse(JSON.stringify(bad))).toEqual(bad);
    expect(Object.getPrototypeOf(bad)).toBe(Object.prototype);
    expect(Object.getPrototypeOf((bad as { error: object }).error)).toBe(Object.prototype);
  });
});
