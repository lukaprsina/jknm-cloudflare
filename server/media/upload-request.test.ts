import { describe, expect, test } from "vite-plus/test";
import { parse_upload_request } from "./upload-request";

const SHA = "a".repeat(64);

const parse = (query: Record<string, string>, content_length: string | null = "1000") =>
  parse_upload_request({
    content_length,
    query: new URLSearchParams({
      filename: "zapisnik.pdf",
      type: "application/pdf",
      sha256: SHA,
      ...query,
    }),
  });

describe("parse_upload_request", () => {
  test("a pdf is described by its allowed type, with the extension that type implies", () => {
    expect(parse({})).toEqual({
      ok: true,
      upload: {
        filename: "zapisnik.pdf",
        content_type: "application/pdf",
        ext: "pdf",
        length: 1000,
        sha256: SHA,
        thumbhash: null,
      },
    });
  });

  test("the extension follows the type, not the filename", () => {
    const result = parse({ filename: "foto.exe", type: "image/png" });
    expect(result.ok && result.upload.ext).toBe("png");
  });

  test("only the allowed types get in", () => {
    for (const type of [
      "image/avif",
      "image/heic",
      "image/svg+xml",
      "text/html",
      "application/zip",
    ]) {
      expect(parse({ type })).toMatchObject({ ok: false, rejection: { status: 415 } });
    }
  });

  test("a missing length is 411; a too-large one is 413, with a smaller cap for images", () => {
    expect(parse({}, null)).toMatchObject({ ok: false, rejection: { status: 411 } });
    expect(parse({}, "104857600")).toMatchObject({ ok: true });
    expect(parse({}, "104857601")).toMatchObject({ ok: false, rejection: { status: 413 } });
    expect(parse({ type: "image/jpeg" }, "20971520")).toMatchObject({ ok: true });
    expect(parse({ type: "image/jpeg" }, "20971521")).toMatchObject({
      ok: false,
      rejection: { status: 413 },
    });
  });

  test("an empty or non-numeric length is rejected", () => {
    for (const length of ["0", "abc", "-5", "1.5"]) {
      expect(parse({}, length)).toMatchObject({ ok: false, rejection: { status: 400 } });
    }
  });

  test("the hash must be 64 lowercase hex characters", () => {
    for (const sha256 of ["", "abc", "A".repeat(64), "g".repeat(64)]) {
      expect(parse({ sha256 })).toMatchObject({ ok: false, rejection: { status: 400 } });
    }
  });

  test("a filename is required and trimmed", () => {
    expect(parse({ filename: "  " })).toMatchObject({ ok: false, rejection: { status: 400 } });
    const result = parse({ filename: "  a b.pdf " });
    expect(result.ok && result.upload.filename).toBe("a b.pdf");
  });

  test("a thumbhash is kept for images when it is base64 of a plausible size, else rejected", () => {
    const result = parse({ type: "image/jpeg", thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j3A" });
    expect(result.ok && result.upload.thumbhash).toBe("3OcRJYB4d3h/iIeHeEh3eIhw+j3A");
    expect(parse({ type: "image/jpeg", thumbhash: "<script>" })).toMatchObject({ ok: false });
    expect(parse({ type: "image/jpeg", thumbhash: "A".repeat(200) })).toMatchObject({ ok: false });
  });
});
