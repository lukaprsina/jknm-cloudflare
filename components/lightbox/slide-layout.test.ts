import { describe, expect, test } from "vite-plus/test";
import { slide_layout } from "./slide-layout";

const desktop = { width: 1920, height: 1080 };
const no_caption = { has_caption: false, caption_height: null, aside_width: 320 };

describe("slide_layout without a caption", () => {
  test("centres the image on both axes", () => {
    const layout = slide_layout({
      image: { width: 1000, height: 500 },
      viewport: desktop,
      ...no_caption,
    });
    expect(layout.caption).toBe("none");
    expect(layout.caption_rect).toBeNull();
    expect(layout.image_rect).toEqual({ x: 460, y: 290, width: 1000, height: 500 });
  });

  test("never enlarges a small image past its stored size", () => {
    const layout = slide_layout({
      image: { width: 480, height: 320 },
      viewport: desktop,
      ...no_caption,
    });
    expect(layout.image_rect).toEqual({ x: 720, y: 380, width: 480, height: 320 });
  });

  test("shrinks a large image to fit, keeping its aspect ratio", () => {
    const layout = slide_layout({
      image: { width: 2000, height: 500 },
      viewport: desktop,
      ...no_caption,
    });
    expect(layout.image_rect).toEqual({ x: 0, y: 300, width: 1920, height: 480 });
  });
});

const captioned = { has_caption: true, caption_height: 60, aside_width: 320 };

describe("slide_layout with an aside caption", () => {
  test("on a wide screen the caption hugs the image and the image stays centred", () => {
    const layout = slide_layout({
      image: { width: 1000, height: 500 },
      viewport: { width: 2560, height: 1080 },
      ...captioned,
    });
    expect(layout.caption).toBe("aside");
    expect(layout.image_rect).toEqual({ x: 780, y: 290, width: 1000, height: 500 });
    expect(layout.caption_rect).toEqual({ x: 1780, y: 290, width: 320, height: 500 });
  });

  test("a small image keeps the caption right beside it", () => {
    const layout = slide_layout({
      image: { width: 480, height: 320 },
      viewport: desktop,
      ...captioned,
    });
    expect(layout.caption).toBe("aside");
    expect(layout.image_rect).toEqual({ x: 720, y: 380, width: 480, height: 320 });
    expect(layout.caption_rect).toEqual({ x: 1200, y: 380, width: 320, height: 320 });
  });

  test("when the margin is too narrow the image shifts left by half the caption width", () => {
    const layout = slide_layout({
      image: { width: 1000, height: 1000 },
      viewport: { width: 1400, height: 1000 },
      ...captioned,
    });
    expect(layout.caption).toBe("aside");
    // area is 1080 wide; the 1000 px image is centred in it
    expect(layout.image_rect).toEqual({ x: 40, y: 0, width: 1000, height: 1000 });
    expect(layout.caption_rect).toEqual({ x: 1040, y: 0, width: 320, height: 1000 });
  });

  test("shrinks the image when even the shifted image does not fit", () => {
    const layout = slide_layout({
      image: { width: 1000, height: 1000 },
      viewport: { width: 1200, height: 1000 },
      ...captioned,
    });
    expect(layout.image_rect).toEqual({ x: 0, y: 60, width: 880, height: 880 });
    expect(layout.caption_rect).toEqual({ x: 880, y: 60, width: 320, height: 880 });
  });
});

describe("slide_layout with a caption below", () => {
  test("on a phone the caption sits under the centred image at the image width", () => {
    const layout = slide_layout({
      image: { width: 800, height: 400 },
      viewport: { width: 400, height: 800 },
      ...captioned,
    });
    expect(layout.caption).toBe("below");
    expect(layout.image_rect).toEqual({ x: 0, y: 300, width: 400, height: 200 });
    expect(layout.caption_rect).toEqual({ x: 0, y: 500, width: 400, height: 60 });
  });

  test("a portrait image on a phone keeps the caption below it, not beside", () => {
    const layout = slide_layout({
      image: { width: 800, height: 1200 },
      viewport: { width: 390, height: 844 },
      ...captioned,
    });
    expect(layout.caption).toBe("below");
    expect(layout.caption_rect?.width).toBe(390);
  });

  test("a wide image on an ultrawide goes below when the side margin is the smaller one", () => {
    const layout = slide_layout({
      image: { width: 2000, height: 500 },
      viewport: { width: 2560, height: 1080 },
      ...captioned,
    });
    expect(layout.caption).toBe("below");
    expect(layout.image_rect).toEqual({ x: 280, y: 290, width: 2000, height: 500 });
    expect(layout.caption_rect).toEqual({ x: 280, y: 790, width: 2000, height: 60 });
  });

  test("a caption taller than the free margin lifts the image, so it ends exactly at the viewport", () => {
    const layout = slide_layout({
      image: { width: 1000, height: 300 },
      viewport: { width: 1000, height: 600 },
      has_caption: true,
      caption_height: 200,
      aside_width: 320,
    });
    expect(layout.image_rect).toEqual({ x: 0, y: 100, width: 1000, height: 300 });
    expect(layout.caption_rect).toEqual({ x: 0, y: 400, width: 1000, height: 200 });
  });

  test("a caption taller than the whole area shrinks the image", () => {
    const layout = slide_layout({
      image: { width: 1000, height: 600 },
      viewport: { width: 1000, height: 600 },
      has_caption: true,
      caption_height: 200,
      aside_width: 320,
    });
    // Area is lifted by the full caption height (400 x 400 left), so the image is 667 x 400.
    expect(layout.image_rect.height).toBeCloseTo(400);
    expect(layout.image_rect.width).toBeCloseTo(666.67, 1);
    expect(layout.image_rect.y).toBeCloseTo(0);
    expect(layout.caption_rect?.y).toBeCloseTo(400);
    expect(layout.caption_rect?.height).toBe(200);
  });

  test("before the caption is measured it takes no height and the image stays centred", () => {
    const layout = slide_layout({
      image: { width: 800, height: 400 },
      viewport: { width: 400, height: 800 },
      has_caption: true,
      caption_height: null,
      aside_width: 320,
    });
    expect(layout.image_rect.y).toBe(300);
    expect(layout.caption_rect?.height).toBe(0);
  });
});

describe("slide_layout padding", () => {
  test("keeps the image off the screen edge and still centred", () => {
    const layout = slide_layout({
      image: { width: 2000, height: 500 },
      viewport: desktop,
      ...no_caption,
      padding: 16,
    });
    expect(layout.image_rect).toEqual({ x: 16, y: 304, width: 1888, height: 472 });
  });

  test("the caption stays inside the padded area", () => {
    const layout = slide_layout({
      image: { width: 1000, height: 1000 },
      viewport: { width: 1400, height: 1000 },
      ...captioned,
      padding: 16,
    });
    const caption = layout.caption_rect!;
    expect(caption.x + caption.width).toBeLessThanOrEqual(1400 - 16);
    expect(layout.image_rect.y).toBeGreaterThanOrEqual(16);
  });
});

describe("slide_layout with a very long caption below", () => {
  const phone = { width: 360, height: 800 };

  test("the caption takes at most 40% of the screen and scrolls beyond that", () => {
    const layout = slide_layout({
      image: { width: 800, height: 1200 },
      viewport: phone,
      has_caption: true,
      caption_height: 700,
      aside_width: 320,
    });
    expect(layout.caption_rect?.height).toBe(320);
    const caption = layout.caption_rect!;
    expect(caption.y + caption.height).toBeLessThanOrEqual(phone.height);
    expect(layout.image_rect.y).toBeGreaterThanOrEqual(0);
  });

  test("a taller caption narrows the image, so the caption must be measured at the new width", () => {
    const base = {
      image: { width: 800, height: 1200 },
      viewport: phone,
      has_caption: true,
      aside_width: 320,
    };
    const short = slide_layout({ ...base, caption_height: 100 });
    const tall = slide_layout({ ...base, caption_height: 300 });
    expect(tall.caption_rect!.width).toBeLessThan(short.caption_rect!.width);
  });
});
