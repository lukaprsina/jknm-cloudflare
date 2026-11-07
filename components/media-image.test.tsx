import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import { MediaImage } from "./media-image";

const image = { url: "https://gradivo.jknm.org/abc/original.jpg", width: 800 };
// A 4x4 orange-ish image, hashed once with `rgbaToThumbHash`.
const THUMBHASH = "GusCBwBYUh91h4iFeBiHWIiPcZAICYgA";

describe("MediaImage", () => {
  test("renders an img for the variant and passes the rest of the props through", () => {
    const html = renderToStaticMarkup(
      <MediaImage
        image={image}
        variant="body"
        width={800}
        height={600}
        alt=""
        loading="lazy"
        className="block"
      />,
    );
    expect(html).toContain('src="https://gradivo.jknm.org/abc/original.jpg"');
    expect(html).toContain('width="800"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('class="block"');
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
    expect(html).toMatch(
      /background-image:url\(&quot;?data:image\/png;base64,|background-image:url\(data:image\/png;base64,/,
    );
    expect(html).toContain("left:4px");
  });
});
