import type { Metadata } from "next";
import { ArticleBody } from "@/components/article-body";
import { ArticleLayout } from "@/components/article-layout";
import { CONTENT_PAGES, is_content_page } from "@/lib/content-pages";
import { page_url } from "@/lib/domains";
import { prepare_article } from "@/lib/prepare-article";
import { not_found_uncached } from "@/lib/not-found-uncached";
import { published_metadata } from "@/lib/published-metadata";
import { get_published } from "@/server/published";

export const revalidate = 3600;
// The five club pages are the only top-level routes. Listing them does not prerender
// them; that only happens with `vinext({ prerender })` or `--prerender-all`, which
// would query the DB at build. `dynamicParams = false` is not used: on vinext it 404s
// the listed slugs too (observed in the built Worker), so `load` checks the slug itself.
export const generateStaticParams = () => CONTENT_PAGES.map(({ slug }) => ({ slug }));

type Props = { params: Promise<{ slug: string }> };

/** The page body must call this itself: `notFound()` raised only from `generateMetadata` still answers 200. */
async function load({ params }: Props) {
  const { slug } = await params;
  // Anything else is not a club page: 404 without a query.
  if (!is_content_page(slug)) return not_found_uncached();
  const result = await get_published().by_content_page(slug);
  if (result.outcome === "not_found") return not_found_uncached();
  return { slug, page: result.page };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug, page } = await load(props);
  return published_metadata(page, page_url(`/${slug}`), "content");
}

export default async function ClubPage(props: Props) {
  const { page } = await load(props);
  const { headings, blocks } = prepare_article(page.content, page.media);
  return (
    <ArticleLayout headings={headings}>
      <ArticleBody blocks={blocks} />
    </ArticleLayout>
  );
}
