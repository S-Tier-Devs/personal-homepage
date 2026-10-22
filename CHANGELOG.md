# Changelog

All user-visible changes, newest first. A release PR bumps the version and adds its
section here in the same commit.

<!-- Started at the ai-standards retrofit. Work before that point was not tracked
here; docs/FEATURES.md → Shipped carries the itemised record with its plan for each
item, and git history is the source of truth. -->

## [0.2.0] — 2026-10-22
- Public blog: `/blog` index, `/blog/[slug]` articles, `/blog/rss.xml`, and blog
  entries in `sitemap.ts`.
- `/dashboard/blog` admin section with search/status filters, activity log, and
  a shared rich-text editor extracted from Notes.
- Agent API for the blog (`/api/blog/posts`, `/api/blog/media`) authorized by
  scoped, revocable `pbk_` bearer tokens managed from Settings — see
  `docs/BLOG_API.md`.
- Blog images hosted on DigitalOcean Spaces (`pb-public-media`, CDN-backed).

## [0.1.0] — unreleased
- Baseline at the time the changelog was added.
