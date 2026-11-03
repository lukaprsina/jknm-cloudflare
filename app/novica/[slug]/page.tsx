import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { ArticleBody } from "@/components/article-body";
import { ArticleToc } from "@/components/article-toc";
import { deployment_origin } from "@/lib/domains";
import { image_url } from "@/lib/image-url";
import { article_json_ld, json_ld } from "@/lib/json-ld";
import { prepare_article } from "@/lib/prepare-article";
import { cn } from "@/lib/utils";
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
  return result;
}

const article_url = (slug: string) => `${deployment_origin()}/novica/${encodeURIComponent(slug)}`;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug, page } = await load(props);
  const url = article_url(slug);
  return {
    title: page.title,
    description: page.excerpt,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: page.title,
      description: page.excerpt,
      publishedTime: page.published_at ?? undefined,
      modifiedTime: page.modified_at,
      // No key at all without a thumbnail, so the default preview image (#10) can apply.
      ...(page.thumbnail && { images: [image_url(page.thumbnail.url, 1200)] }),
    },
  };
}

export default async function Novica(props: Props) {
  const { slug, page } = await load(props);
  const { headings, has_toc, blocks } = prepare_article(page.content);

  const structured_data = article_json_ld(
    page,
    article_url(slug),
    page.thumbnail ? image_url(page.thumbnail.url, 1200) : undefined,
  );

  return (
    // The scroll margin is shared by anchored headings, the sticky column and the scroll-spy.
    <main
      style={{ "--article-scroll-margin": "4.5rem" } as React.CSSProperties}
      className={cn(
        "mx-auto px-4 pb-10",
        has_toc ? "max-w-5xl lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10" : "max-w-3xl",
      )}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: json_ld(structured_data) }}
      />
      {has_toc && <ArticleToc headings={headings} />}
      <article className="pt-6 lg:col-start-1 lg:row-start-1 [&_a]:underline">
        <ArticleBody blocks={blocks} />
        <p className="mt-8 text-sm text-muted-foreground">
          {page.authors.map((author) => author.display_name).join(", ")}
        </p>
      </article>
    </main>
  );
}
