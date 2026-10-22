# Backlog — personal-homepage

Deferred work that is understood but not yet scheduled. Each item is written so a
future session can pick it up cold. Remove an item when it ships (record the
commit in `lessons-learned.md` or a plan if it warranted one).

---

## Tasks page: stream the GSD list instead of blocking navigation

**Date added:** 2026-07-23
**Priority:** Medium (perf / UX)
**Origin:** Diagnosing intermittent page-switch lag. The dashboard-wide part
(dynamic pages, no loading UI) was fixed by adding `app/dashboard/loading.tsx`.
This item is the Tasks-specific remainder.

**Problem.** `app/dashboard/tasks/page.tsx` awaits **two external calls** to
`project-gsd.com` (`getLists()` + `getAllTasks()`, each up to a 10s timeout in
`lib/gsd/client.ts`) *before* the page renders. Navigating to Tasks blocks on
GSD's responsiveness. `loading.tsx` now shows an instant skeleton for the whole
segment, which masks it — but the Tasks content still can't appear until both GSD
round-trips finish, so Tasks stays the slowest section and its skeleton lingers
longest.

**Proposed approach (confirm against Next 16 docs at implementation time — the
App Router streaming API is a flagged breaking-change area in AGENTS.md).**
- Render the Tasks page shell immediately and move the GSD fetch into a child
  Server Component wrapped in its own `<Suspense>` with a list-shaped fallback,
  so navigation completes instantly and only the list area streams in. See
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`
  (Streaming with Suspense) and the `instant-navigation` guide.
- Consider a short server-side cache on the GSD list/tasks response (e.g. a few
  seconds) so back-to-back visits to Tasks don't re-hit the API. Must not cache
  across the key being changed/removed — key it so a `NOT_CONFIGURED` or a
  rotation is reflected promptly. GSD is the source of truth, so keep any cache
  short and refresh-on-demand (the existing refresh button must bypass it).
- Consider trimming the 10s `TIMEOUT_MS` for the *page-load* path so a slow/hung
  GSD caps the skeleton wait sooner (the write paths can keep the longer timeout).
- Optional: evaluate `unstable_instant` (per the Next 16 `loading.js` doc's agent
  hint) for guaranteed-instant navigation — but it is `unstable_`, so treat as a
  separate spike, not a dependency.

**Acceptance (deferred, live — needs the real GSD key):** navigating to Tasks is
visually instant (shell + skeleton), the list streams in a beat later, and a
slow GSD no longer freezes the click. Prove by observing the RSC/navigation
timing in DevTools, not by trusting a green render.

**Files likely touched:** `app/dashboard/tasks/page.tsx` (split shell + suspended
list), a new list Server Component, possibly `lib/gsd/client.ts` (a cached
read + a page-path timeout).

---

## Blog: tag archive pages (`/blog/tag/[tag]`)

**Date added:** 2026-10-22
**Priority:** Low (v1 cut)
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out — F-013 blog design.

**Problem.** Tags are stored, validated, and displayed as plain (non-link) chips in
v1, but there is no route to browse posts by tag.

**Trigger:** once there is enough content for tag filtering to matter, add
`/blog/tag/[tag]` as a small, isolated follow-up.

---

## Blog: short videos in posts

**Date added:** 2026-10-22
**Priority:** Low (deferred, triggered)
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out.

**Problem.** `/api/blog/media` is images-only in v1 (server-side upload through the
route handler).

**Trigger:** the moment video uploads break the server-side upload path
(route-handler body-size and memory limits), presigned uploads and bucket CORS
arrive together — that's the signal to build this, not before.

---

## Blog: hosted pages (markdown / HTML+CSS pages for readers)

**Date added:** 2026-10-22
**Priority:** Low — own feature, own brainstorm
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out.

**Problem.** Not blog content — reader-facing markdown and HTML/CSS pages the owner
wants to host later. Deferred as its own feature rather than folded into F-013.

**Note for then:** serving reader-facing HTML from the CDN origin is the safe shape
(off-origin, no cookies in scope). The `pb-public-media` bucket is already named and
keyed to anticipate this (see `docs/ARCHITECTURE.md` → Packages/boundaries,
`lib/storage/`).

---

## Blog: MCP server over the blog API

**Date added:** 2026-10-22
**Priority:** Low
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out.

**Problem.** `docs/BLOG_API.md` is a plain HTTP + bearer-token contract today. An
MCP server would be a thin wrapper over the same API for MCP-native agent clients.

**Trigger:** demand from an MCP-native agent workflow that doesn't want to hand-roll
HTTP calls.

---

## Documents → Spaces (migration Phase 2)

**Date added:** 2026-10-22
**Priority:** Medium (migration continuation)
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out; continues the
Supabase → DigitalOcean migration (`docs/ARCHITECTURE.md` → Overview).

**Problem.** Documents still store bytes in Supabase Storage. F-013 built
`lib/storage/spaces.ts` with the bucket and CDN as parameters specifically so this
move can reuse it against a private Documents bucket, rather than writing a second
S3-compatible client.

**Note:** this is its own spec, not a follow-on task of F-013 — the bucket-boundary
decision (public `pb-public-media` vs. a private Documents bucket) needs its own
review.

---

## Homepage "Latest writing" section

**Date added:** 2026-10-22
**Priority:** Low
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out.

**Problem.** The one-pager (`design/patrick-beasley.dc.html`) doesn't surface recent
blog posts. A "Latest writing" section pulling the newest live post(s) onto `/` was
cut from v1 scope.

---

## Blog: slug redirects after a published slug change

**Date added:** 2026-10-22
**Priority:** Low
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out.

**Problem.** v1 blocks changing a live post's slug outright (unpublish → edit →
republish) instead of changing it and redirecting the old URL. Inbound links to the
old slug break with no redirect.

**Trigger:** the owner wants to rename a live post's slug without breaking existing
inbound links/bookmarks — build the redirect table then, not speculatively.

---

## Blog: orphaned-image cleanup in Spaces

**Date added:** 2026-10-22
**Priority:** Low (housekeeping)
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out.

**Problem.** Deleting a post does not delete its uploaded images from
`pb-public-media` in v1, so images orphan in the bucket over time (storage cost,
no functional breakage).

**Trigger:** worth building once orphaned storage volume/cost is noticeable; a sweep
job (list images referenced by live `content_html`, delete the rest) is the
straightforward shape.

---

## Header nav overflow at narrow viewports

**Date added:** 2026-10-22
**Priority:** Low (pre-existing, slightly worsened)
**Origin:** F-013 final whole-branch review.

**Problem.** The header nav overflows at viewports of roughly ≤400px. This predates
F-013 (it already happens on `main` with 3 links) and is only marginally worse now
that the blog nav link brings the count to 4. Gap/spacing tweaks are not the fix —
it needs a real responsive treatment (e.g., a collapse to a menu button below a
breakpoint).

**Trigger:** worth fixing opportunistically, or whenever another nav-link addition
makes the overflow more noticeable.

---

## Blog v1 §Out catch-all: comments, newsletter/search/cover images/per-post OG

**Date added:** 2026-10-22
**Priority:** Low (explicitly deferred, v1 cut)
**Origin:** `docs/superpowers/specs/2026-10-22-blog-design.md` §Out — F-013 blog design.

**Problem.** The spec's §Out section explicitly excludes several features from v1
that are not yet separately ledgered here: comments, a newsletter/email digest,
full-text search over post bodies, cover images, and per-post OG image generation.

**Trigger:** each is its own future feature/brainstorm — build only on demand, not
speculatively.

---

## Blog v1 polish

**Date added:** 2026-10-22
**Priority:** Low (polish, non-blocking)
**Origin:** F-013 final whole-branch review.

**Problem.** Several small rough edges noted during final review, none blocking v1:
- The tags input's client-side normalisation (lowercase + hyphenate on blur) is
  weaker than the server's `normalizeTags` — they can disagree at the edges.
- The slug field autosaves mid-typing, so a trailing-hyphen slug can hit the server
  mid-edit and 409/toast before the user finishes typing.
- Publishing with an already-set `published_at` can record a spurious
  "published_at changed" event: the value round-trips through the database with
  microsecond truncation, so the echoed value differs from the sent value by less
  than a millisecond and still reads as a change.
- A live post's excerpt can be emptied via PATCH — `EXCERPT_REQUIRED` only guards
  the draft→published transition, not an edit to an already-published post.
- Concurrent double-DELETE on the same post returns a foreign-key 500 instead of a
  404 for the second request.

**Trigger:** batch these into a small follow-up pass once there's a reason to touch
this area again, or on the next blog-focused session.

### Blog admin: filter-chip counts go stale as the clock crosses `published_at`
- **Date added**: 2026-10-22
- **Priority**: low
- **Origin**: Chrome editor smoke (production), found live
- **Problem**: The All/Published/Drafts/Scheduled chip counts are a `useMemo` over the loaded `posts` array, so they derive status once and don't update as time passes a scheduled post's `published_at`. The row status pill and the detail panel re-run `deriveStatus` every render, so they can disagree with the chips (observed "Scheduled 1 / Published 0" while the selected post showed Published). Admin-only and cosmetic — the public site derives live on each request and was never wrong.
- **Trigger**: fix when touching the blog admin view; cheap options are a periodic re-render (interval tick) or a refetch on window focus, which would also cure the existing "admin status is a point-in-time snapshot" lag noted during the SDD run.
