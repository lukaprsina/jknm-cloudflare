import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { ArticleBody } from "@/components/article-body";
import { ArticleLayout } from "@/components/article-layout";
import { article_path, page_url } from "@/lib/domains";
import { image_src } from "@/lib/media-url";
import { article_json_ld, json_ld } from "@/lib/json-ld";
import { prepare_article } from "@/lib/prepare-article";
import { not_found_uncached } from "@/lib/not-found-uncached";
import { published_metadata } from "@/lib/published-metadata";
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
  if (result.outcome === "not_found") return not_found_uncached();
  if (result.outcome === "redirect") permanentRedirect(article_path(result.slug));
  return result;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug, page } = await load(props);
  return published_metadata(page, page_url(article_path(slug)), "article");
}

export default async function Novica(props: Props) {
  const { slug, page } = await load(props);
  const { headings, blocks } = prepare_article(page.content, page.media);

  const structured_data = article_json_ld(
    page,
    page_url(article_path(slug)),
    page.thumbnail ? image_src(page.thumbnail, "og") : undefined,
  );

  return (
    <ArticleLayout headings={headings}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: json_ld(structured_data) }}
      />
      <ArticleBody blocks={blocks} />
      {page.authors.length > 0 && (
        <p className="mt-8 text-sm text-muted-foreground">
          {page.authors.map((author) => author.display_name).join(", ")}
        </p>
      )}
    </ArticleLayout>
  );
}
