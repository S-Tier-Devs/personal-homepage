# Blog — Public Blog, Admin Section, Agent API, Spaces Media — Design

**Date:** 2026-10-22
**Status:** Owner-reviewed 2026-10-22 (section-by-section brainstorm walkthrough; amendments applied)
**Feature:** F-013
**Mockup:** Claude Design canvas "Blog Mockup" — https://claude.ai/artifact/SFqkoJPyVaD6G4bXU1UfgV
(three frames: Public `/blog`, Public `/blog/[slug]`, Admin `/dashboard/blog`). The
approved mockup is the visual spec; posts, dates and tags in it are sample content.

## Goal

Add a public blog to patrickbeasley.com and a blog admin section behind the existing
login. **Most posts will be created, edited and managed by AI agents**; the owner
edits directly a minority of the time. The design therefore treats the agent API as
a first-class client, not an afterthought.

## Owner decisions (2026-10-22)

| Decision | Choice |
|---|---|
| Editor | **Rich text** — extend the Notes `contenteditable` editor, not Markdown |
| Agent permissions | Agents may **create, edit, delete and publish** |
| Images and files | Hosted on **DigitalOcean Spaces**, not Supabase Storage |
| Mockup | Approved as drawn |

Decisions made in this spec (endorsed at owner review, 2026-10-22):

- **Agent access mechanism: scoped, hashed, revocable API tokens** sent as
  `Authorization: Bearer`. Works for any agent (Claude, Copilot, scripts). An MCP
  server is a thin follow-up over the same API (see Out of scope).
- **Separate public Spaces bucket (`pb-public-media`).** Documents stay private and
  move to Spaces in migration Phase 2 on their own bucket; the security boundary
  between "public by design" and "private by design" is a bucket, not a key prefix.
  The bucket is named for *public media generally*, not the blog: the owner plans to
  later host markdown files, HTML/CSS pages, and short videos for readers, and a
  bucket is effectively un-renamable once its URLs live in published content.
- **Blog is not workspace-scoped** (same list in Work and Home), like Documents and
  Settings.

Review amendments (owner-approved 2026-10-22):

- **Tag archive routes (`/blog/tag/[tag]`) are cut from v1.** Tags are still stored,
  validated and displayed — as plain, non-link chips. Pagination stays.
- **Route namespace is `/api/blog/posts/**` + `/api/blog/media`** — one prefix, one
  auth surface. A deliberate deviation from the flat `/api/links` convention,
  justified by the second credential type.
- **The media endpoint is generalised in name and contract** (behaviour stays
  images-only in v1); short videos and hosted pages are backlogged with explicit
  triggers (see Out).
- **Publish preserves an existing `published_at`** unless one is explicitly supplied.
- **No rate limiting and no token expiry** on the token path — stated decisions, not
  gaps (see Authorization).

## Scope

**In**

1. `blog_posts`, `blog_post_events`, `api_tokens` tables (Drizzle schema + migration).
2. Admin API `/api/blog/posts` (CRUD + publish), `/api/blog/media` (upload), callable
   by the admin session **or** a blog-scoped API token.
3. Token management in Settings (session-only; tokens cannot mint tokens).
4. `/dashboard/blog` section per the mockup: status filters, author badges, editor,
   metadata panel, activity log, `loading.tsx`.
5. Shared rich-text editor extracted from Notes, with the extended toolbar.
6. `sanitizePostHtml` — a second allowlist profile that permits `href`/`src`.
7. Public `/blog`, `/blog/page/[n]`, `/blog/[slug]`, `/blog/rss.xml`; posts in
   `sitemap.ts`; Blog in the public header nav. Tag chips render as plain text (no
   tag routes in v1).
8. DO Spaces bucket + CDN for public media; `lib/storage/spaces.ts` S3-compatible
   client written so Phase 2 (Documents) can reuse it.
9. `docs/BLOG_API.md` — the agent-facing contract (auth, endpoints, payloads, HTML
   rules), written so an agent can be pointed at it cold.

**Out (recorded in `docs/ai/backlog.md` + FEATURES rows)**

- Tag archive pages (`/blog/tag/[tag]`) — tags are stored and displayed from day one,
  so the routes are a small, isolated follow-up once there is enough content for
  filtering to matter.
- Short videos in posts — **trigger:** video uploads break the server-side upload
  path (route-handler body-size and memory limits); that is the moment presigned
  uploads and bucket CORS arrive.
- Hosted pages (markdown and HTML/CSS pages for readers) — own feature, own
  brainstorm. Note for then: serving reader-facing HTML from the CDN origin is the
  safe shape (off-origin, no cookies in scope); the `pb-public-media` bucket already
  anticipates it.
- MCP server wrapping the blog API.
- Moving Documents to Spaces (that is migration Phase 2, own spec).
- Homepage "Latest writing" section.
- Slug redirects after a published slug change (v1 blocks the change instead).
- Orphaned-image cleanup in Spaces.
- Comments, newsletter/email, search, cover images, per-post OG image generation.

## Data model (`lib/db/schema.ts`, one drizzle migration)

### `blog_posts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `slug` | text, unique, not null | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 100 chars; generated from title if omitted |
| `title` | text not null | ≤ 200 chars |
| `excerpt` | text not null default `''` | ≤ 300 chars; required (non-empty) to publish |
| `content_html` | text not null default `''` | always `sanitizePostHtml` output; ≤ 200 000 chars raw |
| `status` | text not null default `'draft'` | check in (`draft`, `published`) |
| `published_at` | timestamptz null | required when `status = 'published'`; may be in the future; survives unpublish (never nulled) |
| `tags` | text[] not null default `'{}'` | each `^[a-z0-9-]{1,32}$` after normalising; ≤ 8 |
| `reading_minutes` | integer not null default 1 | computed server-side from text (≈ 225 wpm, min 1) |
| `created_by` / `updated_by` | text not null | check in (`admin`, `agent`) — same rigour as the `status` check |
| `created_by_token_id` / `updated_by_token_id` | uuid null | FK → `api_tokens.id` on delete set null |
| `created_at` / `updated_at` | timestamptz | `utcNow`, `$onUpdate` — same pattern as `dashboard_notes` |

Index: `(status, published_at desc)`. Check: `status <> 'published' or published_at is not null`.

**"Scheduled" is derived, not stored:** a post is *live* when
`status = 'published' and published_at <= now()`. A published post with a future
`published_at` shows as **Scheduled** in the admin and becomes live without a cron
job (public pages revalidate; see Caching). This keeps the state machine to two
values.

**`published_at` survives the unpublish → republish cycle:** publishing keeps an
existing `published_at` unless the request explicitly supplies one, defaulting to now
only when it is null; unpublishing never nulls it. The slug lock deliberately pushes
the owner toward unpublish → edit → republish, so that cycle must not reset a post's
date or bounce it to the top of `/blog`. Explicitly sending a value still overrides.

### `blog_post_events` (activity log)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `post_id` | uuid null | FK → `blog_posts.id` **on delete set null** — history survives deletion |
| `post_title` | text not null | snapshot, so a deleted post's events stay readable |
| `actor` | text not null | `'admin'` / `'agent'` |
| `token_id` | uuid null | FK → `api_tokens.id` on delete set null |
| `action` | text not null | check in (`created`, `updated`, `published`, `unpublished`, `deleted`) |
| `summary` | text not null default `''` | e.g. "title, excerpt"; field names only, never values |
| `created_at` | timestamptz | |

Written in the same transaction as the post change.

### `api_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | owner label, e.g. "Claude — blog" |
| `token_hash` | text unique not null | SHA-256 hex of the full token |
| `token_prefix` | text not null | first 12 chars (`pbk_` + 8), for display |
| `scopes` | text[] not null | v1 only `{'blog'}` |
| `created_at`, `last_used_at`, `revoked_at` | timestamptz | `last_used_at` updated at most once per minute per token |

Token format: `pbk_` + 32 random bytes base64url (from `crypto.randomBytes`). Shown
**once** at creation; never returned again. SHA-256 (not argon2) is correct here: the
token is 256 bits of entropy, so a slow hash adds nothing, and lookup must be by hash.

## Authorization

Invariant preserved: **the first statement of every handler is an auth guard; there
is still no RLS.** A new guard sits beside `requireAdminAuth`:

```ts
// lib/auth/blog-guard.ts
requireBlogAuth(request): Promise<
  | { actor: { kind: "admin"; userId: string } | { kind: "agent"; tokenId: string }; db }
  | { error: NextResponse }
>
```

- If an `Authorization` header is present it must be `Bearer pbk_…`; it is hashed and
  looked up (`revoked_at is null`, `'blog' = any(scopes)`). A present-but-invalid
  header is a 401 — it **never falls back** to the cookie session.
- Otherwise the existing session path (`verifyClaims` + `isAdminEmail`) runs.
- Used **only** by `/api/blog/**` (posts and media). Every other route keeps
  `requireAdminAuth`, so a leaked blog token can touch blog posts and blog media and
  nothing else. A unit test asserts that only `app/api/blog/**` imports
  `requireBlogAuth`.
- Token routes (`/api/api-tokens/**`) use `requireAdminAuth`: a token can't create,
  list or revoke tokens.
- Failed token lookups log the token **prefix** only, never the value (same spirit
  as the `logQueryError` invariant).

Stated decisions (deliberate omissions, not gaps — do not "fix" at review):

- **No rate limiting on the token path.** A 256-bit random token makes online
  guessing infeasible, and App Platform has no shared store to rate-limit against.
- **A single `'blog'` scope carrying all four verbs.** The owner decided agents may
  create, edit, delete and publish, so finer scopes (`blog:read`, `blog:publish`)
  would be enforcement without a policy behind it. The `scopes` array makes
  granularity additive later, not a migration.
- **No token expiry.** An expiring token is an agent that silently breaks on a
  schedule; instant revocation plus `last_used_at` visibility cover the risk at T0.

This is an auth-surface change, so it gets a decision record in
`docs/ai/decision-records.md` and an AGENTS.md invariant line. It is compatible with
migration Phase 3: the session half of the guard swaps from Supabase to opaque
sessions; the token half is unaffected.

## Admin API

Follows the binding conventions (`app/api/links/` reference): `apiError` wire
format, `isUuid` guard on `[id]`, `logQueryError`, bare entity on create/update,
`{ ok: true }` on delete, named collection on list.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/blog/posts` | `{ posts }`, all statuses, `updated_at desc`; optional `?status=draft\|published\|scheduled` — `published` = live (`published_at <= now()`), `scheduled` = published with a future date; both are **derived filters**, there is no `'scheduled'` column value. List items omit `content_html`. |
| POST | `/api/blog/posts` | Create. Body: `title` (required), `content_html`, `excerpt`, `slug`, `tags`, `status`, `published_at`. 201. |
| GET | `/api/blog/posts/[id]` | Full post incl. `content_html` and its last 20 events. |
| PATCH | `/api/blog/posts/[id]` | Partial update; same validation as POST. Publishing = `{ "status": "published", "published_at"? }` — keeps an existing `published_at`, defaults to now only when null. Unpublish = `{ "status": "draft" }` (keeps `published_at`). |
| DELETE | `/api/blog/posts/[id]` | Hard delete; event row retained. `{ ok: true }`. |
| GET | `/api/blog/posts/[id]/events` | Full activity log for the post. |
| POST | `/api/blog/media` | multipart `file`, optional `alt`. → `201 { url, contentType, width?, height?, alt? }` — dimensions filled for images (all of v1). Images-only in v1; the general name and shape are deliberate (future media types are additive). |
| GET/POST | `/api/api-tokens` | Session only. POST returns `{ token, ...meta }` once. |
| DELETE | `/api/api-tokens/[id]` | Session only. Sets `revoked_at` (soft) so events keep their reference. |

Validation and error codes (added to `ApiErrorCode`): `INVALID_SLUG`, `SLUG_TAKEN`
(409, also mapped from `23505`), `SLUG_LOCKED` (409 — slug of a **live** post cannot
change; unpublish first, deliberately, because it breaks inbound links),
`EXCERPT_REQUIRED` (400 on publish with empty excerpt), `INVALID_TAGS`,
`INVALID_DATE`, `UNAUTHENTICATED`/`FORBIDDEN` from the guard,
`INVALID_IMAGE_TYPE`, `IMAGE_TOO_LARGE`.

Every successful mutation calls `revalidatePath` for `/blog`, the post's
`/blog/[slug]` (old and new slug on rename), and `/blog/rss.xml`. Paginated index
pages (`/blog/page/[n]`) are deliberately not enumerated — they self-heal within the
5-minute `revalidate` window, and that staleness is accepted.

**Concurrency:** PATCH accepts an optional `if_updated_at`; if present and stale →
409 `CONFLICT`. The admin editor's autosave sends it, so an agent edit made while the
owner has the editor open is surfaced ("This post changed — reload") instead of being
silently overwritten. Agents are documented to send it too.

## HTML: `sanitizePostHtml`

`lib/sanitize.ts` keeps its tokenizer; the allowlist becomes a profile parameter.
`sanitizeNoteHtml` is unchanged in behaviour (its tests must stay green untouched).

Post profile:

- Tags: `p br strong b em i h2 h3 ul ol li blockquote pre code a img figure figcaption hr`.
- Attributes, only these, everything else dropped:
  - `a[href]` — `https:`, `http:`, `mailto:`, or a root-relative path (`/…` but not
    `//…` or `/\…`). Validated by **resolving** against a fixed origin, per the
    open-redirect lesson in AGENTS.md, never by prefix match. Output always adds
    `rel="noopener noreferrer"`; external links also get `target="_blank"`.
  - `img[src]` — must resolve to the configured media CDN origin
    (`SPACES_MEDIA_CDN_URL`). Anything else drops the `<img>` entirely. This keeps the
    CSP tight and stops agent-authored posts from embedding third-party tracking pixels.
  - `img[alt]` — text, ≤ 300 chars.
  - `img[width]` / `img[height]` — positive integers ≤ 10 000. These carry the
    dimensions the upload endpoint returns; stripping them would silently defeat the
    no-layout-shift goal. Agents omitting them still work, with layout shift.
- Idempotent (sanitize twice = sanitize once), as the Notes sanitiser is.
- Heading `id`s for anchor links are added at **render** time from heading text, not
  stored.

Agents send HTML in this subset; `docs/BLOG_API.md` documents it and states that
anything outside it is silently removed.

## Media on DigitalOcean Spaces

- **Bucket:** new Spaces bucket `pb-public-media` (nyc3), CDN enabled, objects
  public-read. Named for public media generally — hosted pages and short videos are
  on the owner's horizon, and a bucket is effectively un-renamable once its URLs live
  in published content. Key layout: `blog/{yyyy}/{mm}/{uuid}.{ext}` — the `blog/`
  prefix leaves room for sibling content types. Objects immutable
  (`Cache-Control: public, max-age=31536000, immutable`).
- **Upload:** server-side only (`/api/blog/media` → `PutObject`), so no CORS
  config and no presigned upload in v1. Allowlist by **sniffed magic bytes**, not
  browser MIME (see the MIME lesson in AGENTS.md): JPEG, PNG, WebP, GIF. **No SVG**
  (script vector). Max 10 MB. Width and height are read from the header and
  returned so the renderer can set them (no layout shift).
- **Client:** `@aws-sdk/client-s3` against the Spaces endpoint, wrapped in
  `lib/storage/spaces.ts` (`putObject`, `publicUrl` — `deleteObject` arrives with its
  first caller; nothing in v1 deletes objects). Bucket and CDN
  are parameters, so Phase 2 can point the same module at a private Documents bucket.
- **Env vars** (added via the **live** spec procedure, never by applying
  `.do/app.yaml`): `SPACES_KEY`, `SPACES_SECRET` (`RUN_TIME`, `type: SECRET`, blank
  in the committed spec), `SPACES_REGION`, `SPACES_MEDIA_BUCKET`,
  `SPACES_MEDIA_CDN_URL` (plain `RUN_TIME`). Prefer a Spaces access key **limited to
  this bucket** if DO offers per-bucket keys at implementation time; verify, don't assume.
- **CSP:** `img-src` gains the CDN origin. `connect-src` is unchanged (browser never
  talks to Spaces directly).
- **Editor image button:** file picker → upload → `insertImage` with the returned URL,
  then prompt for alt text. Agents upload via the same endpoint with their token.

Deleting a post does not delete its images in v1 (backlog item: orphan sweep).

## Admin UI (`/dashboard/blog`) — per the mockup

- `NAV_ENTRIES` gains `blog` (sidebar only, `inTabBar: false` — the tab bar is
  already six items). Overview is unchanged in v1.
- Page shape per binding conventions: server page fetches the list → plain arrays →
  `"use client"` `blog-view.tsx`. `app/dashboard/blog/loading.tsx` shaped like the card.
- Left: search + status filter chips (All / Published / Drafts / Scheduled) with
  counts; rows show title, status pill, **Agent / You** badge (`updated_by`),
  relative time. Search filters **title + tags, client-side** — the list payload
  omits `content_html`, so body text is deliberately not searched. The chips
  partition disjointly: Published = live, Scheduled = published with a future date,
  Drafts = draft; every post sits under exactly one chip and the counts sum to All.
- Centre: title input, toolbar, editor. Autosave (debounced, like Notes) for drafts.
  **Live posts don't autosave**: edits are held until "Update", so a half-typed
  sentence never goes live.
- Right: Save draft / Publish (or Update / Unpublish for live posts), status,
  publish date (future date ⇒ Scheduled), URL slug (locked with an explanation
  while live), excerpt (with counter), tags, activity log, "Preview post ↗"
  (admin-only preview route `/dashboard/blog/[id]/preview` rendering the public
  template, `noindex`).
- Delete lives in a kebab menu with a confirm step (the Links kebab pattern).
- Mobile: the Notes master-detail pattern (list → editor as detail); the metadata
  panel stacks below the editor. The mockup frames are desktop; this is the specified
  mobile adaptation. Real-phone verification is in the deferred test list.

### Shared editor

Extract the `contenteditable` + toolbar from `components/dashboard/notes/notes-view.tsx`
into `components/editor/rich-text-editor.tsx` with a `tools` prop. Notes passes its
existing four tools and must be behaviourally unchanged; Blog passes Bold, Italic,
H2, H3, Bullet list, Numbered list, Link, Quote, Code block, Image. The
`[contenteditable]` base styles in `globals.css` gain `ol`, `h2`, `blockquote`,
`pre`, `img` rules (Tailwind preflight resets them, as the existing comment explains).

This extraction is the **risk-bearing slice** of the feature: Link (URL input +
selection preservation), Code block (`contenteditable` block-handling quirks) and
Image (async upload mid-edit) are qualitatively harder than the four Notes tools. The
plan should budget slice 3 accordingly, and "Notes behaviourally unchanged — its
tests stay green, plus a manual smoke" is a hard gate on that slice.

## Public pages

- `/blog` — index per the mockup: latest post featured, then a list; 10 per page;
  `/blog/page/[n]` for older pages. Tag chips render as plain text in v1 (tag archive
  routes are backlogged).
- `/blog/[slug]` — article per the mockup: tags, title, excerpt lead, published and
  updated dates, reading time, body, previous/next. `generateMetadata` sets title,
  description (excerpt), canonical URL (from `getSiteUrl()`), Open Graph and
  `article:published_time`. Non-live slugs → `notFound()`.
- `/blog/rss.xml` — route handler, RSS 2.0, latest 20 live posts, full sanitised
  HTML. Root-relative `href`s are rewritten to absolute via `getSiteUrl()` at feed
  render time — a relative link has no origin inside a feed reader. (`img src`s are
  already absolute CDN URLs.)
- `sitemap.ts` adds `/blog` and every live post (`lastModified = updated_at`), and
  switches its base URL to `getSiteUrl()` (fixes the apex/www inconsistency noted in
  `lib/env.ts`).
- Header: nav becomes About / Projects / Blog / Contact. Off the homepage the anchors
  become `/#about`, `/#projects`, `/#contact`. `design/patrick-beasley.dc.html`
  stays the spec for the homepage itself; the blog frames of the approved mockup are
  the spec for the new pages.
- **Caching:** public blog routes are statically rendered with
  `revalidate = 300` (so scheduled posts appear within ~5 min without a cron) plus
  on-demand `revalidatePath` on every mutation. ⚠ Confirm the Next 16 API names and
  semantics (`revalidate`, `revalidatePath`, `generateStaticParams`, any
  `cacheLife`/`"use cache"` changes) in `node_modules/next/dist/docs/` at plan
  time — AGENTS.md flags this as a breaking-change area.
- `proxy.ts` matcher is unchanged: `/blog` must not run through session middleware.

## Agent contract — `docs/BLOG_API.md`

The document an agent is pointed at. Contents: base URL, `Authorization: Bearer`
usage, every endpoint with request/response examples, the HTML subset (including
`img[width]`/`img[height]` and the fact that anything outside the subset is silently
removed), the media upload flow (upload first, then reference the returned URL — and
dimensions — in `<img>`), slug and tag rules, `if_updated_at` usage,
publish/schedule/unpublish recipes (including that publish preserves an existing
`published_at`), error codes, and "never put the token in post content or logs". Kept in sync with the routes — a
docs-ownership-table row is added for it.

## Testing

Unit (Vitest):

- `sanitizePostHtml`: allowed tags and attributes; `javascript:`, `data:`,
  `//evil.com`, `/\evil.com`, and entity-obfuscated schemes in `href` are dropped;
  `img` off the CDN origin is removed; `img[width]`/`img[height]` survive
  sanitisation (integers only, cap enforced); `rel` is added; idempotence; Notes
  sanitiser output unchanged against its existing tests.
- `requireBlogAuth`: valid token; revoked token; wrong scope; malformed header with a
  valid session cookie is still 401 (no fallback); session admin; session non-admin.
- Token hashing/format; `last_used_at` throttling.
- Slug generation, validation, `SLUG_LOCKED`; tag normalisation; reading time;
  live/scheduled derivation; `EXCERPT_REQUIRED`; `published_at` preserved across
  unpublish → republish (reset only when explicitly supplied).
- Image sniffing: JPEG/PNG/WebP/GIF accepted by bytes; SVG and a PNG-named HTML file
  rejected; size cap.
- Guard-scope test: only `app/api/blog/**` imports `requireBlogAuth`.

Live / deferred (recorded, not skipped — need real infra):

- End-to-end agent run with `curl` and a real token: upload image → create draft →
  schedule → appears on `/blog` after `published_at` → update → unpublish → delete.
  Prove each step by **reading the database and fetching the public URL**, not by
  trusting the 200.
- Image served from the CDN with the immutable cache header, rendering under the
  production CSP (no console violations).
- RSS validates (W3C feed validator); sitemap lists live posts only.
- Editor on a real phone (contenteditable + image picker).

Gate as always: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`,
exit codes checked directly.

## Delivery slices (for the plan)

1. Schema + migration; `api_tokens` + `requireBlogAuth`; token routes and the Settings card.
2. `sanitizePostHtml`; `/api/blog/posts/**` with events, `if_updated_at`, revalidation hooks.
3. Shared editor extraction (Notes unchanged) + `/dashboard/blog` UI — the
   risk-bearing slice (see Shared editor).
4. Public pages, RSS, sitemap, header nav, metadata.
5. Spaces bucket/env/CSP + `lib/storage/spaces.ts` + `/api/blog/media` + editor image button.
6. `docs/BLOG_API.md`, decision record, AGENTS.md invariant, ARCHITECTURE.md
   (routes, tables, Spaces), README (drop "No blog"), FEATURES → Shipped,
   CHANGELOG + version **0.2.0**.

Infra steps the owner runs (or approves) once: create the bucket and CDN, create the
Spaces key, add env vars via the live-spec procedure (`doctl apps propose` dry run
first).

## Risks

- **Agents can delete.** Owner decision. Mitigations: events survive deletion with a
  title snapshot; tokens are revocable instantly from Settings; the token
  `last_used_at` shows activity. A soft-delete/trash is a cheap follow-up if wanted.
- **Agent edits racing the owner's editor** — handled by `if_updated_at` (409).
- **Prompt-injected content in posts** — handled structurally: the sanitiser is the
  boundary, and images can only come from our own bucket.
- **Second auth path** — scoped to blog routes by construction and by test.
