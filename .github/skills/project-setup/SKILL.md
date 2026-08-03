---
name: project-setup
description: Reproduce THIS project's setup from scratch — repo scaffold, Supabase auth wiring, env config, DigitalOcean spec, CI baseline. Use when rebuilding personal-homepage's environment or standing up a comparable module. Trigger phrases: project setup, reproduce setup, rebuild environment, auth wiring.
---

# Project Setup — personal-homepage

<!-- Renamed from `project-bootstrap` to stop colliding with the ai-standards kit
skill of that name, which is installed globally at ~/.claude/skills/project-bootstrap
and stamps the generic kit onto ANY repo. This one is different in kind: it is this
project's own setup runbook, and Stage 3.5 in particular carries auth wiring that
exists nowhere else. Do not merge the two. -->

Reproduces this project's environment. For stamping the generic agent-instructions kit
onto a repo, use the global `project-bootstrap` skill instead.

## Use When
- Starting a new project or adding a major new service/module
- Setting up a new developer environment for this project
- Reproducing the project setup from scratch

## Required Inputs
- Project name and description
- Target stack (already defined: Next.js, Supabase, DigitalOcean App Platform, TypeScript, Tailwind)
- Deployment target (DigitalOcean App Platform)
- Auth provider (Supabase + Google OAuth)

## Workflow Stages

### Stage 1 — Repository
- [ ] Create GitHub repo with description and license
- [ ] Clone locally and verify remote
- [ ] If using a GitHub PAT with `gh`, ensure scopes include `repo`, `workflow`, `read:org`, and `project`
- [ ] Confirm `.gitignore` covers `node_modules`, `.env*`, `.next`, `supabase/.branches`

### Stage 2 — App Scaffold
- [ ] Run `create-next-app` with TypeScript, ESLint, Tailwind, App Router
- [ ] Verify `npm run build` passes on clean scaffold
- [ ] Add `@supabase/supabase-js` and `@supabase/ssr` dependencies

### Stage 3 — Environment Setup
- [ ] Create `.env.local` from `.env.example` template
- [ ] Add: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`BUILD_TIME`) and `ADMIN_EMAIL` (`RUN_TIME`, plain) in `.do/app.yaml`; set only `SUPABASE_SERVICE_ROLE_KEY` out of band as a `RUN_TIME` `SECRET`, never in a file, because it bypasses RLS
- [ ] Verify `.env.local` is git-ignored
- [ ] Verify `.env.example` is committed even if the repo ignores `.env*`

### Stage 3.5 — Auth Provider Wiring
Email + password, with magic link as a backup. There is no OAuth provider — see the
2026-07-21 decision record.
- [ ] Enable the Email provider in Supabase Auth, and **disable public sign-ups**
- [ ] Create the admin user in Studio with **"Auto Confirm User" checked**. An unconfirmed address fails as `email_not_confirmed`, which the login form deliberately reports as the generic "Invalid email or password" — so check the Supabase auth logs, not the UI
- [ ] Add that address to `public.admin_users`. `is_admin()` matches on **email**, not user id, so no id linkage is required
- [ ] Leave session timebox and inactivity timeout **OFF** — this is what makes sessions last indefinitely per device
- [ ] Add `/auth/confirm` to the redirect allowlist for local **and** production (needed for magic link only; password sign-in uses no redirect). App Platform creates no preview environments of its own, and the Vercel project was deleted 2026-07-27 — there are no preview URLs at all now, so only local and production hosts need allowlisting
- [ ] Run one password sign-in and one magic-link sign-in end to end

### Stage 4 — AI Docs
- [ ] Create all `.github/` AI markdown files with starter outlines
- [ ] Verify frontmatter is valid YAML
- [ ] Commit AI docs as first substantive commit

### Stage 5 — CI Baseline
- [ ] Add GitHub Actions workflow: lint, typecheck, build on push/PR
- [ ] Verify workflow passes on initial commit

### Stage 6 — Tracking
- [ ] Create GitHub Issues for all planned tasks and research items
- [ ] Create GitHub Project board with columns: Backlog, In Progress, Blocked, Done
- [ ] Add labels: `task`, `research`, `blocked`, `security`, `infra`, `bug`, `enhancement`

## Artifacts Generated
- Scaffolded Next.js app
- `.env.example` with all required variable names (no values)
- `.github/` AI instruction and prompt files
- GitHub Actions CI workflow
- GitHub Issues and Project board

## Verification Checklist
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] No secrets in git history (`git log --all -p | grep -nE "ghp_|sk_|secret"`)
- [ ] DigitalOcean App Platform auto-deploys `main` on merge (`deploy_on_push: true` in `.do/app.yaml`)
- [ ] Supabase migration dry run reports expected SQL before apply and "up to date" after apply

## Failure Handling
- If `create-next-app` fails midway, delete the directory and retry with `--yes` flag
- If the DigitalOcean App Platform deploy fails, check environment variables match `.env.example` names exactly
- If Supabase connection fails, verify `NEXT_PUBLIC_SUPABASE_URL` does not have a trailing slash
- If git push requires a temporary credentialed remote URL, reset the remote to a clean HTTPS URL immediately after the push succeeds
