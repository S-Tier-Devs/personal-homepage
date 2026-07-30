# Supabase → DigitalOcean Migration — Umbrella Roadmap + Phase 1 (Data) Design

**Date:** 2026-07-29
**Status:** Approved by owner (umbrella + Phase 1)
**Motivation:** Consolidation on DigitalOcean (which already hosts this app and three others) and owning the stack outright. Not cost-driven.

## Umbrella: three phased sub-projects

The app depends on Supabase for three pillars. Each phase lands, deploys, and is
revertable independently; production works between phases. Each later phase gets
its own spec when its turn comes — this document binds Phase 1 and records the
umbrella decisions all phases inherit.

| Phase | Pillar | Target | Spec |
|---|---|---|---|
| 1 | Postgres data + data-access layer | `homepage` DB on existing `apps-pg` cluster; Drizzle ORM | this document |
| 2 | File storage (`files` bucket) | DO Spaces, presigned attachment-disposition GETs | future |
| 3 | Auth | Self-managed: passkey-first (SimpleWebAuthn) + argon2id password fallback, opaque session tokens in Postgres | future |

### Umbrella decisions (owner-approved, binding on all phases)

- **Database:** shared `apps-pg` cluster (nyc3, pg 17), NOT a dedicated cluster.
  New database `homepage` + same-named user, mirroring the `gsd` pattern.
- **Data layer:** Drizzle ORM. Schema in TypeScript; `drizzle-kit generate`
  emits plain-SQL migrations (committed under `drizzle/`); typed queries make
  `npx tsc --noEmit` catch schema drift.
- **Storage (Phase 2):** DO Spaces. The 50MB cap becomes a route-level check
  only — Spaces has no bucket-level size backstop.
- **Auth surface (Phase 3):** passkey + password fallback, per the
  `standards-auth` self-managed reference (T0/T1 pattern). No magic link — this
  removes the only feature that would require an email provider.
- **Session lifetime (Phase 3): 12 months absolute**, per the standards pack.
  Owner-approved 2026-07-29; supersedes the 2026-07 "sessions last indefinitely
  per device" decision.
- **Authorization posture:** RLS stops being the enforcement layer at Phase 1
  cutover. The single server-side choke point is `requireAdminAuth` as the
  first statement of every handler (already universal). With one user this is
  the standards pack's lean-authorization model, not a weakening.
- **Maintenance windows:** every phase whose cutover could orphan writes takes
  the site offline first via App Platform maintenance mode, toggled by editing
  the **live** spec (`doctl apps spec get` → edit → `doctl apps update`), never
  by applying the committed spec (AGENTS.md secret-blanking trap). The window
  takes down the public one-pager too; acceptable for minutes on a personal
  site. ⚠ Verify the exact spec field (`maintenance.enabled`) against DO docs
  at plan time; do not trust memory.
- **Supabase teardown:** the project is deleted only after Phase 3 plus a soak
  period. Until then it is the rollback target, frozen at Phase 1 copy time.

### End state

App runs entirely on DigitalOcean. `@supabase/supabase-js`, `@supabase/ssr`,
`lib/auth/jwks.ts`/`claims.ts`, all RLS policies, and the Supabase project are
gone. Per-request auth is one in-region Postgres lookup of a hashed opaque
token.

---

## Phase 1: Data migration — detailed design

### Scope

**In:** provision `homepage` DB/user; Drizzle schema + migrations; one-time data
copy; rewrite every PostgREST call site (all `app/api/**` routes and dashboard
pages) to Drizzle; retire `admin_users`, RLS, `is_admin()`, `set_updated_at`,
`increment_link_click` as DB objects; cutover runbook with maintenance window.

**Out:** storage (files routes keep using Supabase Storage for bytes — but
`files_metadata` rows move), auth (Supabase Auth still verifies sessions),
Supabase project deletion.

### Infrastructure (one-time, recorded here for reproducibility)

DO Managed Postgres has no IaC spec file; these are `doctl`/MCP operations:

1. Create database `homepage` on cluster `apps-pg`
   (`e7e891cb-e694-4357-af84-b12755bd4d0b`).
2. Create user `homepage`; grant full rights on database `homepage` only.
   Verify isolation: user `homepage` cannot connect to `gsd`, and vice versa.
3. App connects via the cluster's **private hostname** with `sslmode=require`
   (app and cluster are both NYC; private path avoids public egress).
4. Add the app as a trusted source on the cluster firewall.
5. New env var in the app spec: `DATABASE_URL` (`RUN_TIME`, `type: SECRET`, set
   out of band exactly like `SUPABASE_SERVICE_ROLE_KEY`; blank in the committed
   spec). The three Supabase vars remain until Phase 3.

### Schema (lib/db/schema.ts)

Tables carried, byte-compatible with today's shapes:

| Table | Notes |
|---|---|
| `dashboard_categories` | 25 rows |
| `dashboard_links` | 16 rows, includes `pinned`, `sort_order`, `click_count` |
| `dashboard_notes` | 10 rows |
| `files_metadata` | 0 rows; storage bytes stay in Supabase until Phase 2 |
| `gsd_config` | 1 row (GSD API key; single-row check constraint carries over) |
| `contact_submissions` | 3 rows, April 2026 — inside the 12-month retention window; carried for retention only, no code reads it |

**Not carried:** `site_profile`, `projects`, `external_links`, `blog_posts`
(empty v1 legacy — this closes the standing "legacy table drop" backlog item),
`admin_users` (existed to feed `is_admin()` for RLS; `requireAdminAuth`'s
`ADMIN_EMAIL` comparison already does this job), every RLS policy, `is_admin()`.

**DB objects that become app code:**

- `set_updated_at` trigger → Drizzle `$onUpdate` per table.
- `increment_link_click` RPC → plain `UPDATE dashboard_links SET click_count =
  click_count + 1 WHERE id = $1` in `app/api/links/[id]/click/route.ts`.

Migrations: `drizzle-kit generate` → committed SQL in `drizzle/`; applied by
`npm run db:migrate` (a small script using Drizzle's migrator). Phase 1 applies
them manually, like today's MCP flow; a pre-deploy job is a possible later
refinement, not part of this phase.

### Data copy

One-time script in the session scratchpad (not committed): read via the
existing Supabase server client, insert via Drizzle. ~55 rows total.
Verification before cutover: row counts match per table; spot-check a sample
row per table field-by-field; sequences (where serial) reset to `max(id)`;
UUIDs copy verbatim.

### Code changes

- **Reference implementation first:** Links (`app/api/links/`,
  `app/dashboard/links/page.tsx`), then all other routes/pages mirror it.
- Handler shape is unchanged: `requireAdminAuth` first statement, `isUuid`
  guard, `apiError()` wire format, bare-entity create/update responses,
  `{ ok: true }` deletes, named collection keys. Only query lines change.
- `requireAdminAuth` returns `{ user, db }` (Drizzle handle) instead of
  `{ user, supabase }`; session verification is untouched this phase (local
  JWKS verify via `@supabase/ssr` cookies).
- `lib/dashboard/api.ts` retypes from the Supabase client to the Drizzle
  client. `lib/gsd/key.ts` and the settings page move to Drizzle queries.
- **Files routes are dual-client this phase:** `files_metadata` rows via
  Drizzle, storage bytes (upload/remove/signed URL) via a Supabase server
  client the route creates itself (`createServerSupabaseClient`) — the only
  routes that keep a direct Supabase data dependency until Phase 2. The
  `uploaded_by` column keeps storing the Supabase auth user id this phase;
  Phase 3 revisits it when user ids change source.
- `lib/supabase/admin.ts` (service-role client) is already dead code — deleted
  this phase. `SUPABASE_SERVICE_ROLE_KEY` stays in the spec until Phase 3 out
  of caution, flagged for removal then.
- Connection pooling: `postgres.js` with an explicit small pool (max 4) —
  basic-xxs app + 1GB shared cluster; never the driver default.

### Testing

- All existing tests keep passing; route tests swap Supabase mock chains for
  Drizzle mocks at the same boundary.
- New: a pool-config unit test (max connections = 4) and a migration-SQL
  snapshot review in the plan's gates.
- Gates unchanged: `npm run lint`, `npx tsc --noEmit`, `npm test`,
  `npm run build`, each checked on its own exit code.

### Cutover runbook (maintenance window)

1. Enable App Platform maintenance mode (live-spec edit). Site offline —
   no dashboard writes possible.
2. Run the data copy; run verification queries against `apps-pg`.
3. Merge + push the cutover build (`deploy_on_push` proceeds during
   maintenance).
4. Prove the deployed app reads/writes `apps-pg`: create + delete a canary
   row through the live API, read it back via SQL on `apps-pg`, confirm
   nothing arrived in Supabase.
5. Disable maintenance mode.

### Rollback

`git revert` the cutover merge + push. The app points back at Supabase, whose
data is frozen at copy time. The maintenance window guarantees the set of
post-cutover writes needing manual reconciliation is bounded and known (rows
created between cutover and revert — visible in `apps-pg`).

### Error handling

- DB connection failures surface exactly as Supabase errors do today: caught in
  handlers, returned as `apiError("DB_ERROR", ...)`-style 500s; no retry layer.
- Drizzle query errors that were previously Postgres codes via PostgREST
  (e.g. unique violations on category names → 409) keep their mappings; the
  plan enumerates each route's current error mapping and preserves it.

### Success criteria

- All dashboard sections read/write `apps-pg` in production; Supabase Postgres
  receives zero queries (verify via Supabase dashboard query stats after a day).
- 131+ tests green; four gates green.
- Canary write proven in `apps-pg` via SQL read-back.
- gsd unaffected (its DB untouched; cluster CPU/memory checked after cutover).
