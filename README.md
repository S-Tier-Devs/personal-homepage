# personal-homepage

[patrickbeasley.com](https://patrickbeasley.com) — a public one-page site, plus a private admin dashboard behind it.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| Database, auth, storage | Supabase |
| Hosting | DigitalOcean App Platform |

## What it is

**Public site** (`/`) — a single page: About, Projects, and a Contact section that is a `mailto:` link, not a form. Dark theme by default, light theme available, preference persisted. No blog.

**Private dashboard** (`/dashboard`) — a personal workspace for one admin, not a CMS:

| Section | |
|---|---|
| Links | Categorised bookmarks with search, filter and sort |
| Notes | Rich-text notes with debounced autosave |
| Tasks | Project-GSD tasks: view, check off, quick add. Proxied server-side; key managed in Settings; not workspace-scoped |
| Documents | File upload, signed-URL download, delete |
| Feeds | Placeholder |
| Settings | Manage the categories used by Links and Notes |

Everything is split across two **workspaces**, Work and Home, which swap the accent colour and filter content. Two important exceptions: **Documents and Settings are not workspace-scoped.** `files_metadata` has no `ctx` column, so documents are one shared list; Settings deliberately shows both workspaces side by side so categories can be compared.

## Auth

Email and password, with a magic link as backup. There is **no OAuth provider** — that was removed; see the 2026-07-21 decision record.

Access is allowlist-based rather than role-based. `public.admin_users` holds permitted email addresses, and `public.is_admin()` — a `SECURITY DEFINER` function — checks the caller's JWT email against it. Every RLS policy on every private table calls it. Note that it matches on **email, not user id**, so replacing the auth user does not require touching `admin_users`.

Sessions are deliberately indefinite per device: session timebox and inactivity timeout are both off in Supabase.

## Data model

`supabase/migrations/` is the source of truth. Applied migrations are tracked in `supabase_migrations.schema_migrations`; the versions there must match the filenames here.

| Table | |
|---|---|
| `admin_users` | Email allowlist backing `is_admin()` |
| `dashboard_categories` | Per-workspace categories, `ctx` × `kind` (`link`/`note`) |
| `dashboard_links` | Bookmarks; `category_id` is `on delete restrict` |
| `dashboard_notes` | Notes; `content_html` is always sanitised server-side before storage |
| `files_metadata` | Document metadata; objects live in the private `files` storage bucket |
| `gsd_config` | Single-row Project-GSD API key, managed from Settings (write-only; never returned by any API) |

`site_profile`, `projects`, `external_links`, `blog_posts` and `contact_submissions` are **orphaned v1 tables**. Nothing reads them. They are kept pending an export and a deliberate drop.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Required environment variables for local development, see `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL`

In production (`.do/app.yaml`), `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are `BUILD_TIME` values baked in at build time. `SUPABASE_SERVICE_ROLE_KEY` is the only real secret: `RUN_TIME`, `type: SECRET`, empty in the committed spec and set out of band, because it bypasses RLS. `ADMIN_EMAIL` is a plain `RUN_TIME` value in the spec, not a secret - it is the address this site publishes as its contact link, and it is only compared against an already-authenticated session, so keeping it in the spec costs nothing and lets the app be recreated from that file alone. `NEXT_PUBLIC_SITE_URL` is deliberately not set in production, `getSiteUrl()` in `lib/env.ts` falls back to the `www` host.

Never commit `.env.local`.

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Deployment

Hosted on DigitalOcean App Platform, app `personal-homepage`, region `nyc`. `.do/app.yaml` is the source of truth for the app spec, including domains, ingress rules and env var scoping - never edit the app in the DO web console, or the console and the spec drift.

Production deploys from `main` on merge (`deploy_on_push: true`). App Platform does not create per-PR preview environments. A Vercel preview URL may still appear on PRs, because the Vercel project is deliberately kept connected as the hosting rollback path; it disappears when that project is deleted at teardown. Verify locally with `npm run build && npm start` before merge, and check production after merge.

`www.patrickbeasley.com` is canonical. The apex `patrickbeasley.com` redirects to it via an ingress rule in `.do/app.yaml` - it does not serve content directly.

There is no container registry; DigitalOcean builds from GitHub source (`S-Tier-Devs/personal-homepage`) using buildpacks.

## Design source

`design/patrick-beasley.dc.html` is a committed, read-only snapshot of the Claude Design prototype. **It is the behavioural specification** — when the design and prose disagree, the design wins. Cite line numbers from it rather than paraphrasing from memory.

## Docs

| | |
|---|---|
| `AGENTS.md` | Conventions and hard-won gotchas — **read before writing code** |
| `docs/ai/decision-records.md` | Decisions, with superseded ones marked |
| `docs/ai/lessons-learned.md` | Running log of things that cost time |
| `docs/ai/backlog.md` | Understood-but-unscheduled work, written to pick up cold |
| `docs/superpowers/plans/` | Implementation plans |
| `.github/instructions/` | File-scoped coding standards |
| `.github/skills/` | Multi-step workflow checklists |
