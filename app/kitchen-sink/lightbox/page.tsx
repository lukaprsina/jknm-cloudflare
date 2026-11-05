import { ArticleBody } from "@/components/article-body";
import { prepare_article } from "@/lib/prepare-article";

export const metadata = { title: "Lightbox harness" };

// Offline stand-ins: SVGs with the stored pixel size written on them.
const svg = (w: number, h: number, hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="hsl(${hue} 50% 45%)"/><path d="M0 0L${w} ${h}M${w} 0L0 ${h}" stroke="#fff" stroke-width="${Math.max(2, w / 200)}"/><text x="50%" y="50%" font-size="${Math.max(16, w / 12)}" fill="#fff" text-anchor="middle">${w}x${h}</text></svg>`,
  )}`;

const image = (w: number, h: number, hue: number, caption?: string) => ({
  type: "image",
  data: { file: { url: svg(w, h, hue), width: w, height: h }, caption },
});

const LONG =
  "Dolg podnapis, ki se v ozkem pasu lepo prelomi v več vrstic. ".repeat(6) +
  '<a href="https://www.jknm.si">povezava</a>, <b>krepko</b> in <i>ležeče</i>.';

const content = {
  blocks: [
    { type: "paragraph", data: { text: "Slike različnih velikosti in podnapisov." } },
    image(480, 320, 20, "Majhna slika iz leta 2008 (480 px)."),
    image(1600, 900, 200, "Široka slika."),
    image(800, 1200, 120, LONG),
    image(2000, 500, 300),
    image(1200, 1200, 60, "Kvadrat."),
    image(1600, 1067, 260, LONG),
  ],
};

export default function Page() {
  const { blocks } = prepare_article(content as never);
  return (
    <main className="mx-auto max-w-3xl p-8">
      <ArticleBody blocks={blocks} />
    </main>
  );
}
