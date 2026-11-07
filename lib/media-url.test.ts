import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { image_src, lightbox_natural } from "./media-url";

const ORIGIN = "https://gradivo.jknm.org";
const KEY = "0b0f1c2e-1111-4222-8333-444455556666/original";
const OPTS = "fit=scale-down,format=auto,onerror=redirect";

const jpeg = (width: number, crop?: { x: number; y: number; width: number; height: number }) => ({
  url: `${ORIGIN}/${KEY}.jpg`,
  width,
  crop,
});

// vitest runs in development mode; the edge behaviour is the production one.
beforeEach(() => vi.stubEnv("NODE_ENV", "production"));
afterEach(() => vi.unstubAllEnvs());

describe("image_src", () => {
  it("asks Cloudflare for the variant's width when the source is wider", () => {
    expect(image_src(jpeg(2000), "body")).toBe(
      `${ORIGIN}/cdn-cgi/image/width=960,${OPTS}/${KEY}.jpg`,
    );
    expect(image_src(jpeg(2000), "lightbox")).toBe(
      `${ORIGIN}/cdn-cgi/image/width=1600,${OPTS}/${KEY}.jpg`,
    );
  });

  it("serves the stored file when it is no wider than the variant", () => {
    expect(image_src(jpeg(960), "body")).toBe(`${ORIGIN}/${KEY}.jpg`);
    expect(image_src(jpeg(480), "lightbox")).toBe(`${ORIGIN}/${KEY}.jpg`);
  });

  it("makes social previews JPEG, which every crawler reads", () => {
    expect(image_src(jpeg(2000), "og")).toBe(
      `${ORIGIN}/cdn-cgi/image/width=1200,fit=scale-down,format=jpeg,onerror=redirect/${KEY}.jpg`,
    );
  });

  it("leaves what Cloudflare cannot transform alone", () => {
    for (const url of [
      `${ORIGIN}/${KEY}.pdf`,
      `${ORIGIN}/${KEY}.avif`,
      `${ORIGIN}/${KEY}.svg`,
      `https://example.com/photo.jpg`,
    ]) {
      expect(image_src({ url, width: 3000 }, "body")).toBe(url);
    }
  });

  it("transforms png, gif and webp sources", () => {
    for (const ext of ["png", "gif", "webp"]) {
      const url = `${ORIGIN}/${KEY}.${ext}`;
      expect(image_src({ url, width: 3000 }, "body")).toContain("/cdn-cgi/image/");
    }
  });

  it("is the stored URL in development, where there is no /cdn-cgi/image", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(image_src(jpeg(2000), "body")).toBe(`${ORIGIN}/${KEY}.jpg`);
  });

  describe("cards", () => {
    it("fill a 16:9 box", () => {
      expect(image_src(jpeg(2000), "card")).toBe(
        `${ORIGIN}/cdn-cgi/image/width=480,height=270,fit=cover,format=auto,onerror=redirect/${KEY}.jpg`,
      );
      expect(image_src(jpeg(2000), "card-featured")).toBe(
        `${ORIGIN}/cdn-cgi/image/width=960,height=540,fit=cover,format=auto,onerror=redirect/${KEY}.jpg`,
      );
    });

    it("crop to the editor's rectangle first, as trim fractions top;right;bottom;left", () => {
      const crop = { x: 10, y: 20, width: 50, height: 60 };
      expect(image_src(jpeg(2000, crop), "card")).toBe(
        `${ORIGIN}/cdn-cgi/image/trim=0.2;0.4;0.2;0.1,width=480,height=270,fit=cover,format=auto,onerror=redirect/${KEY}.jpg`,
      );
    });

    it("clamp a rectangle that overshoots the image by rounding error", () => {
      const crop = { x: -0.0001, y: 0, width: 100.0002, height: 100 };
      expect(image_src(jpeg(2000, crop), "card")).toContain("trim=0;0;0;0,");
    });

    it("transform even a small source when there is a crop to apply", () => {
      const crop = { x: 0, y: 0, width: 50, height: 50 };
      expect(image_src(jpeg(300, crop), "card")).toContain("trim=0;0.5;0.5;0,");
    });

    it("serve a small uncropped source as it is; CSS fills the box", () => {
      expect(image_src(jpeg(300), "card")).toBe(`${ORIGIN}/${KEY}.jpg`);
    });
  });
});

describe("lightbox_natural", () => {
  it("is the stored size up to the lightbox variant's 1600 px, scaled down beyond", () => {
    expect(lightbox_natural({ width: 1200, height: 800 })).toEqual({ width: 1200, height: 800 });
    expect(lightbox_natural({ width: 3200, height: 2400 })).toEqual({ width: 1600, height: 1200 });
  });
});
