import { describe, expect, test } from "vite-plus/test";
import { stored_object_headers } from "./object-headers";

const SHA = "b".repeat(64);

describe("stored_object_headers", () => {
  test("images get no Content-Disposition; files get their name, RFC 5987 escaped, and metadata carries it percent-encoded", () => {
    const image = stored_object_headers({
      content_type: "image/png",
      filename: "a.png",
      sha256: SHA,
    });
    expect(image.content_disposition).toBeUndefined();
    const file = stored_object_headers({
      content_type: "application/pdf",
      filename: "Črni kal (1).pdf",
      sha256: SHA,
    });
    expect(file.content_disposition).toBe("inline; filename*=UTF-8''%C4%8Crni%20kal%20%281%29.pdf");
  });
});
