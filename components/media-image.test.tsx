import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import { MediaImage } from "./media-image";

const image = { url: "https://gradivo.jknm.org/abc/original.jpg", width: 800 };
// A 4x4 orange-ish image, hashed once with `rgbaToThumbHash`.
const THUMBHASH = "GusCBwBYUh91h4iFeBiHWIiPcZAICYgA";

describe("MediaImage", () => {
  test("renders the variant's URL, with no placeholder without a ThumbHash", () => {
    const html = renderToStaticMarkup(<MediaImage image={image} variant="body" alt="" />);
    expect(html).toContain('src="https://gradivo.jknm.org/abc/original.jpg"');
    expect(html).not.toContain("background-image");
  });

  test("shows the ThumbHash behind the picture while it loads, keeping the caller's style", () => {
    const html = renderToStaticMarkup(
      <MediaImage
        image={{ ...image, thumbhash: THUMBHASH }}
        variant="body"
        alt=""
        style={{ left: 4 }}
      />,
    );
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("left:4px");
  });
});
