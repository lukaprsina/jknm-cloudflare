# Public routes never read the session

Public routes (`/`, `/novica/<slug>`, the five content pages, sitemap, robots) do not read the session. Their output is a pure function of the database, so the response store can cache them and tag invalidation can purge them. Admin-only views move to `/uredi` (step 6); admin chrome on public pages (the edit pencil) is a client component that fetches its own session state.

This replaces the old rule "archived articles 404 for non-admins". Archived and deleted articles now 404 on public routes for everyone, and an admin previews them in the editor.

## Why

In Vinext, `headers()` marks a render dynamic, and a dynamic render is never admitted to the response store, even when the read is inside a Suspense child. One session read anywhere in a page therefore makes the whole page uncacheable. The old site avoided this only by being `force-dynamic` on the content pages and leaning on `unstable_cache` for data. Caching by cookie is worse than dropping the admin view.

## Consequences

- The public-read module has no `is_admin` parameter. Visibility is one check: `status === "published"`, then primary-slug comparison (a renamed-away slug 308s to the primary; a hidden article 404s without redirecting).
- The homepage drafts and archived panels (admin-only in the old `app/page.tsx`) leave `/`; they belong to step 6.
- Every public page sets `revalidate` explicitly and relies on tag propagation for purging. The exception is the redirect-only `/si` routes: they must export none of `revalidate`, `dynamic = "force-static"` or `generateStaticParams`, because vinext would then store the response and no tag reaches a stored redirect. Whether tag propagation purges a dynamic `[slug]` route, and whether a 308 is admitted to the store, are verified in the first step 4 ticket against `vp preview`.
- `lib/cache-policy.ts` loses its admin-related comment on `article.unarchived`; the `article` tag is re-examined there.

## Considered options

- **Vary the cache by session cookie.** Rejected: it still requires reading the cookie, which is exactly what makes the render dynamic.
- **Keep the session read in a Suspense island on the server.** Rejected: Vinext marks the whole render dynamic regardless of Suspense.
