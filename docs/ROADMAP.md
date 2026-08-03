# Roadmap

## Versioning rules

Minor bump for features, patch for fixes. The version lives in `package.json`; the
bump and its `CHANGELOG.md` section land in the same PR (see docs/CONTRIBUTING.md →
Release procedure). No lockstep guard is wired yet — it is a manual discipline.

## Phases

**Supabase → DigitalOcean migration.** Phase 1 (data) shipped 2026-07-30: all app data
now lives in DO Managed Postgres via Drizzle. Remaining phases move **auth** (Supabase
session verification via `@supabase/ssr`) and **storage bytes** (Documents) off
Supabase. Supabase's Postgres is retained frozen as the rollback target until the auth
phase lands. Spec:
`docs/superpowers/specs/2026-07-29-supabase-to-digitalocean-phase-1-data-design.md`.

## History

| Version | Date | Summary |
|---|---|---|
| pre-1.0 | 2026-07-21 → 2026-07-30 | Rebuild v2 through DO migration phase 1 — see docs/FEATURES.md Shipped for the itemised record. No CHANGELOG existed for this period; git history is the source. |
