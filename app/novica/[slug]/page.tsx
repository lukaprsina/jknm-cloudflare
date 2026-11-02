import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { image_url } from "@/lib/image-url";
import { get_published } from "@/server/published";

export const revalidate = 3600;
// Without this, vinext never stores a dynamic route's responses. Unknown slugs
// still render on demand.
export const generateStaticParams = () => [];

type Props = { params: Promise<{ slug: string }> };

/**
 * Leaves via `notFound()` / `permanentRedirect()`. The page body must call this
 * itself: `notFound()` raised only from `generateMetadata` still answers 200.
 */
async function load({ params }: Props) {
  const result = await get_published().by_slug((await params).slug);
  if (result.outcome === "not_found") {
    // A dynamic render is never stored, so junk URLs cannot accumulate entries.
    await connection();
    notFound();
  }
  if (result.outcome === "redirect")
    permanentRedirect(`/novica/${encodeURIComponent(result.slug)}`);
  return result.page;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: (await load(props)).title };
}

export default async function Novica(props: Props) {
  const page = await load(props);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold">{page.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {page.authors.map((author) => author.display_name).join(", ")}
      </p>
      {page.thumbnail && (
        // oxlint-disable-next-line next/no-img-element -- images skip the framework optimizer
        <img
          src={image_url(page.thumbnail.url, 800)}
          width={page.thumbnail.width}
          height={page.thumbnail.height}
          alt=""
          className="mt-6 h-auto w-full"
        />
      )}
      {/* Placeholder until the content render pass: block text, tags stripped. */}
      {page.content?.blocks.map((block, index) => (
        <p key={block.id ?? index} className="mt-4">
          {"text" in block.data && typeof block.data.text === "string"
            ? block.data.text.replace(/<[^>]*>/g, "")
            : null}
        </p>
      ))}
    </main>
  );
}
