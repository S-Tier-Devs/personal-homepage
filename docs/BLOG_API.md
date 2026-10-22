# Blog API — agent contract

The API agents use to create, edit, publish, and delete blog posts on
patrickbeasley.com. Point an agent at this file; it needs nothing else.

**Base URL:** `https://www.patrickbeasley.com`
**Auth:** every request carries `Authorization: Bearer pbk_…` (a blog-scoped
token from Dashboard → Settings → Blog API tokens). Tokens are shown once at
creation and are revocable instantly. **Never put the token in post content,
logs, or URLs.** A missing header on a browser session also works (admin
cookie) — agents always use the header.

A present-but-invalid header is a 401; it never falls back to a session.
Tokens cannot manage tokens.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/blog/posts` | List all posts (no bodies). `?status=draft\|published\|scheduled` — `published` = live now, `scheduled` = future-dated. |
| POST | `/api/blog/posts` | Create. |
| GET | `/api/blog/posts/{id}` | Full post + last 20 activity events. |
| PATCH | `/api/blog/posts/{id}` | Partial update / publish / unpublish. |
| DELETE | `/api/blog/posts/{id}` | Hard delete (events survive). |
| GET | `/api/blog/posts/{id}/events` | Full activity log. |
| POST | `/api/blog/media` | Upload an image (multipart). |

Errors are `{ "error": "CODE", "message": "human text" }`. Codes you must
handle: `UNAUTHENTICATED` (401), `INVALID_BODY` (400 — malformed/non-object
JSON, missing title, a bad `status` value or filter, or no updatable fields
on PATCH), `INVALID_SLUG`, `SLUG_TAKEN` (409),
`SLUG_LOCKED` (409 — live slug; unpublish first), `EXCERPT_REQUIRED`,
`INVALID_TAGS`, `INVALID_DATE`, `INVALID_TITLE`, `INVALID_CONTENT`,
`CONFLICT` (409 — stale `if_updated_at`; re-GET and retry),
`INVALID_IMAGE_TYPE`, `IMAGE_TOO_LARGE`,
`STORAGE_ERROR` (500 — media storage write failed; retry later),
`NOT_FOUND`, `SERVER_ERROR`.

## Post fields

- `title` — required, ≤ 200 chars.
- `slug` — `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 100 chars; generated from the title
  when omitted. A LIVE post's slug cannot change.
- `excerpt` — ≤ 300 chars; **required (non-empty) to publish**.
- `content_html` — HTML in the subset below, ≤ 200 000 chars.
- `tags` — ≤ 8 of `^[a-z0-9-]{1,32}$` (server lowercases/hyphenates).
- `status` — `draft` or `published`. Scheduled = `published` with a future
  `published_at`; the post goes live by itself within ~5 minutes of that time.
- `published_at` — ISO 8601. On publish: an explicit value wins; otherwise an
  existing value is KEPT; only a null one defaults to now. Unpublishing keeps it.
- Read-only: `reading_minutes`, `created_by`, `updated_by`, timestamps.

## Concurrency — send `if_updated_at`

Always include the post's current `updated_at` as `if_updated_at` in PATCH
bodies, copied verbatim from your last GET. A 409 `CONFLICT` means someone
(likely the owner's editor) changed the post — re-GET, merge, retry. Omitting
it silently overwrites their work; don't.

## HTML subset

Allowed: `p br strong b em i h2 h3 ul ol li blockquote pre code a img figure
figcaption hr`. **Anything else — tags or attributes — is silently removed**,
including whole `<img>` elements whose `src` is not on the blog CDN.

- `a href` — `https:`, `http:`, `mailto:`, or a root-relative path (`/…`).
- `img src` — must be a URL returned by `/api/blog/media`. `alt` (≤ 300
  chars), `width`, `height` (integers) are kept — always set width/height
  from the upload response to avoid layout shift.
- Heading anchors are generated at render time; do not add `id` attributes.

## Image upload flow

1. `POST /api/blog/media` with multipart field `file` (JPEG/PNG/WebP/GIF by
   magic bytes, ≤ 10 MB; SVG is rejected). Optional field `alt`.
2. Response: `201 { "url", "contentType", "width", "height", "alt" }`.
3. Reference it: `<img src="{url}" alt="…" width="{width}" height="{height}">`.
   Upload FIRST, then write the post.

## Recipes

Create a draft → `POST /api/blog/posts` `{ "title": "…", "content_html": "…", "excerpt": "…", "tags": ["…"] }`
Publish now → `PATCH …/{id}` `{ "status": "published", "if_updated_at": "…" }`
Schedule → `PATCH …/{id}` `{ "status": "published", "published_at": "2026-11-01T09:00:00Z", "if_updated_at": "…" }`
Unpublish → `PATCH …/{id}` `{ "status": "draft", "if_updated_at": "…" }`
Rename a live post's slug → unpublish, PATCH the slug, republish (the original
`published_at` is preserved automatically).
