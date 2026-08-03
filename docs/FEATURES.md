# Features

Intake, backlog, and shipped record. Every idea, review finding, or piece of user
feedback gets a row here before it gets built (see docs/CONTRIBUTING.md → Feature
intake). When a feature ships, its row moves to **Shipped** — fresh sessions read
that table to learn what's built.

<!-- Row template:
| F-0XX | Title | One-line description. | you / user:<name> / review | proposed | — |
Status values: proposed → assigned (vX.Y) → shipped (vX.Y) / rejected
When shipped, move the row to ## Shipped.

The Shipped rows below were backfilled at the ai-standards retrofit from the dated
plans in docs/superpowers/plans/ — each cites its plan, which is the evidence. Version
numbers are unknown for that history (the repo had no CHANGELOG until the retrofit),
so they read "pre-1.0". Work shipped from here on carries a real version.
-->

## Assigned

| ID | Title | Description | Source | Status | Notes |
|---|---|---|---|---|---|

## Unassigned

| ID | Title | Description | Source | Status | Notes |
|---|---|---|---|---|---|
| F-012 | Stream the GSD list on Tasks | Move the two `project-gsd.com` calls into a child Server Component behind its own `<Suspense>` so navigation completes instantly. | review | proposed | Full writeup in `docs/ai/backlog.md`; confirm against Next 16 streaming docs at implementation time |

## Shipped

| ID | Title | Description | Source | Status | Notes |
|---|---|---|---|---|---|
| F-001 | Rebuild v2 | Ground-up rebuild of the site. | you | shipped (pre-1.0) | `plans/2026-07-21-rebuild-v2-plan.md` |
| F-002 | Server-side auth | Sign-in moved off the Supabase browser SDK onto Server Actions. | you | shipped (pre-1.0) | `plans/2026-07-21-server-side-auth.md` |
| F-003 | Dashboard perf + Notes/Links fixes | Removed two network auth round-trips from every authenticated request. | review | shipped (pre-1.0) | `plans/2026-07-22-dashboard-perf-notes-links.md` |
| F-004 | Link edit + kebab menu | Edit a link's title, URL, and category; per-row actions folded into a kebab menu. | you | shipped (pre-1.0) | `plans/2026-07-22-links-edit-kebab-menu.md` |
| F-005 | GSD key management | Manage the Project-GSD API key from Settings, with verify-on-save. | you | shipped (pre-1.0) | `plans/2026-07-23-gsd-key-management.md` |
| F-006 | Tasks section | `/dashboard/tasks`, structurally identical to Links, reading from Project-GSD. | you | shipped (pre-1.0) | `plans/2026-07-23-tasks-gsd-section.md` |
| F-007 | Dashboard overview | Replaced the `/dashboard` → Links redirect with a read-only briefing page. | you | shipped (pre-1.0) | `plans/2026-07-24-dashboard-overview.md` |
| F-008 | Link click tracking | All-time click counts per link, with a count badge and most-used surfacing. | you | shipped (pre-1.0) | `plans/2026-07-24-link-click-tracking.md` |
| F-009 | Notes mobile master-detail | List and editor show one pane at a time on phones. | you | shipped (pre-1.0) | `plans/2026-07-24-notes-mobile-master-detail.md` |
| F-010 | Document upload expansion | Any file type up to 50MB, downloads forced to `attachment`. | you | shipped (pre-1.0) | `plans/2026-07-28-document-upload-expansion.md` |
| F-011 | DO migration phase 1 — data | All app data moved to the `homepage` database on the DO `apps-pg` cluster via Drizzle. | you | shipped (pre-1.0) | `plans/2026-07-29-do-migration-phase-1-data.md`; later phases move auth and storage |
