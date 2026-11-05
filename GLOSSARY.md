# Glossary

Domain vocabulary for the JKNM (Jamarski klub Novo mesto) news site: articles, their lifecycle, and the admin who edits them. Vocabulary only. Implementation lives in the code, which is the spec.

- **Article status**: one of `draft` / `published` / `archived` / `deleted`. `archived` covers both "hide a mistake" and "archive something stale". Archived and deleted articles 404 on public routes, for everyone (ADR-0001); an admin previews them in the editor. `deleted` is terminal.
- **Standalone draft**: a `draft` with no `supersedes_id`. Never been published; archiving or deleting it acts on itself.
- **Superseding draft**: a `draft` whose `supersedes_id` points at a `published` or `archived` row (spawned by pencil-to-edit or "restore from archive"). A published source stays live until the draft is published. Archive and delete on a superseding draft act on the **source**; to cancel the revision, **discard** the draft instead.
- **Discard**: cancel a superseding draft without touching its source. If the source was already retired by unarchiving, discarding puts it back to `archived`.
- **Unarchive**: spawn a superseding draft from an `archived` article. The archived source is retired (`deleted`) immediately, since there is no public visibility to protect.
- **Supersede-publish**: publishing a superseding draft whose source is still `published`. The draft inherits the source's slug, `published_at` and legacy id; the source is retired.
- **Admin**: anyone with a session. Only verified `@jknm.si` Google identities can sign in, so "signed in" and "is admin" are the same fact; there is no separate role check.
- **Slug**: an article's public URL segment, held apart from the article row so renames can leave a redirect behind. One slug is primary. Collisions are resolved by suffixing.
- **Reconciliation**: deriving which media an article uses by re-reading its `content_json` on every save, rather than tracking links at upload time. Uploads never carry an article id.
- **Article kind**: `article` (news, the default) or `content` (one of the five fixed evergreen pages `/klub`, `/publiciranje`, `/raziskovanje`, `/varstvo`, `/zgodovina`). Content-kind articles are not news events: no byline treatment, and excluded from literal news listings (sitemap, homepage feed, `/preveri`).
- **Published set**: the articles visible to the public. Events that change membership of it also change the homepage feed, the archive and the sitemap.
- **Domain event**: what happened (`article.published`, `author.renamed`, ...). Mutations emit one and never name cache tags or paths. A single pure policy maps each event to the invalidations it causes.
- **Author**: a byline entry on an article, either a club `member` or a `guest`.
- **Lightbox**: the full-screen overlay that shows one article image at a time, with its caption. Opened by clicking an image in an article.
- **Gallery**: the ordered set of an article's images that one lightbox steps through. Not a separate content type; it is derived from the article's image blocks.
- **Natural size**: an image's stored pixel size. The article shows small images enlarged (display size), but the lightbox lays out and zooms against the natural size, so a 480 px image never looks sharper than it is.
