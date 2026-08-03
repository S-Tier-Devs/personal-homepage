<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- ============================================================
CANONICAL AGENT INSTRUCTIONS — tool-neutral.
CLAUDE.md contains `@AGENTS.md`; .github/copilot-instructions.md points here.
Edit THIS file, never the pointers.

SIZE BUDGET: ~150 lines. This file loads on EVERY agent session.
The test for any addition: does it describe HOW TO WORK HERE?
  - "How to work here" (commands, conventions, invariants, gotchas) → belongs here
  - "What was built" (feature detail, spec history, endpoint catalogs) → belongs in
    docs/ARCHITECTURE.md or a dated spec in docs/superpowers/specs/ — link it instead
If a section grows past ~25 lines, extract to docs/ and leave a pointer.
============================================================ -->

## Project

personal-homepage is a public one-pager at `/` plus a private admin dashboard at
`/dashboard`, on **Next.js 16** and **Tailwind CSS v4** — both differ from what you
likely remember. Route handler signatures, `params`, and CSS layering are the usual
places this bites. The backend is mid-migration off Supabase onto DigitalOcean.

Living docs: `docs/ARCHITECTURE.md` (system map, deploy detail, migration state — read
before architectural decisions), `docs/FEATURES.md` (backlog + shipped record),
`docs/ROADMAP.md`, `CHANGELOG.md`, `docs/ai/backlog.md` (long-form deferred work).
Specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`. Workflow and
onboarding: `docs/CONTRIBUTING.md` — see its **docs-ownership table** for which file
to update when.

## Commands

    npm install
    npm run dev                         # Next dev server on :3000
    npm run lint                        # eslint
    npx tsc --noEmit                    # typecheck (no npm script)
    npm test                            # vitest run
    npm run build                       # next build
    npm run db:generate                 # drizzle-kit generate (reads .env.local)
    npm run db:migrate                  # drizzle-kit migrate  (reads .env.local)

Both db scripts read `.env.local` via `node --env-file`, not `.env`.

## Workflow (repo convention — all contributors and their agents)

<!-- STANDARD BLOCK — keep identical across repos. Update the master in
ai-standards/templates/AGENTS.md first, then sync outward. -->

- New feature/change → superpowers:brainstorming → spec → superpowers:writing-plans
  → plan → **superpowers:subagent-driven-development** to execute. Do not implement
  plan tasks inline.
- **UI designs get a visual mockup before the spec is finalized:** when a design adds
  or reshapes a page, publish a self-contained HTML mockup (representative data
  clearly labeled as mock) and get sign-off on it as part of the brainstorm — the
  approved mockup is referenced in the spec.
- Model selection — session (main loop), in tiers so it survives model releases:
  brainstorming, spec writing, and plan writing run on the most capable model;
  subagent orchestration (executing the plan via subagent-driven-development)
  likewise. Switch sessions/models at the plan→execution handoff.
- Model selection — subagent dispatch: cheapest tier when the plan contains the
  complete code (transcription); mid-tier for integration/real-run tasks and all
  reviewers; most capable model for the final whole-branch review. Always specify
  the model explicitly on dispatch.
- After all tasks: final whole-branch review with the accumulated Minor-findings
  list for triage → ONE fix subagent → superpowers:finishing-a-development-branch.
- A feature isn't finished until its `docs/FEATURES.md` row exists and sits
  in **Shipped** with the version. Fresh sessions learn what's built by
  reading that table — a stale table recreates the re-explaining problem.
- Feature branches (`feat/<name>`), never implement on main. The SDD ledger
  (`.superpowers/sdd/progress.md`) survives compaction — trust it and `git log`
  over recollection.
- **Finish by pushing and opening a PR** (`gh pr create`); merge after the CI gate
  is green.

## Local environment

- Node with `--env-file` support. `.env.local` carries the DB vars the drizzle scripts
  read; `.env.example` is the committed contract.
- `DATABASE_URL` points at DigitalOcean Managed Postgres over the **public** hostname
  with `sslmode=require` — see Deploy target. There is no local Postgres container.
- Parallel agent instances must NOT share a checkout or a database — use separate
  worktrees, and do not point two instances at the same `homepage` database.

## Deploy target

- Deploy target: **DigitalOcean App Platform** (`provider-digitalocean` pack; app
  `personal-homepage`, region `nyc`). Infra map, env-var inventory, and the migration
  leftovers are in `docs/ARCHITECTURE.md` → Deployment.
- `.do/app.yaml` is the source of truth for *review* — **never edit the app in the DO
  web console**, or console and spec drift. Production deploys from `main` on merge
  (`deploy_on_push: true`); routine code changes need no spec work.
- **Never apply the committed spec directly.** Two values are deliberately blank and
  applying the file overwrites the live ones with empty, silently. Edit the live spec
  (`doctl apps spec get`), `doctl apps propose` as a dry run, then update — full
  procedure in `docs/ARCHITECTURE.md`.
- **Use the public database hostname, not the private one.** App Platform is not on
  the cluster's VPC, so `private-apps-pg-...` is unroutable: every query waits out the
  driver's connect timeout and fails `CONNECT_TIMEOUT`. This broke production for ~15
  minutes and presented as extreme slowness, not an outage — the public one-pager
  stayed fine so uptime checks were green. `requireAdminAuth` calls `getDb()` on every
  successful auth, so *every* admin route depends on it at request time.

## Auth

- Auth: **T0 personal** (tier per the `standards-auth` skill) — a single admin
  identified by `ADMIN_EMAIL`, pattern: platform auth (Supabase session verification
  via `@supabase/ssr` + local JWKS). Load `standards-auth` before touching auth code.
- `requireAdminAuth(request)` is the single authorization choke point — there is **no
  RLS** on the DigitalOcean database, deliberately. Weakening it has no second line of
  defence behind it.
- Auth moves off Supabase in a later migration phase. A tier change is a
  decision-record event.

## Invariants

- `requireAdminAuth(request)` is the **first** statement of every route handler —
  before `params` is awaited and before the body is read.
- **There is no RLS.** Authorization is application-level only; every data path must
  route through `requireAdminAuth`.
- **Never log a raw query error or its wrapper message.** `DrizzleQueryError` puts
  parameter *values* in `message` — it leaked the GSD API key once. Use
  `logQueryError`, which logs the label, the unwrapped SQLSTATE, and the cause's
  message.
- **Never revoke `EXECUTE` on `public.is_admin()`.** RLS policy expressions run in the
  *querying* role's security context, so revoking breaks every admin query. The
  `PUBLIC` grant hides behind a bare `=X` in `proacl`, so a `has_function_privilege`
  check filtered over `pg_roles` will not see it.
- **Workspace scoping is not uniform.** Links and Notes filter by the active
  workspace; **Documents and Settings do not**. Pattern-matching on Links and adding
  `useWorkspace()` filtering silently builds the wrong thing.
- `design/patrick-beasley.dc.html` is the behavioural spec for the public page. Cite
  its line numbers; do not paraphrase from memory.

## Binding conventions

`components/dashboard/links/` and `app/api/links/` are the reference implementation.
Mirror them rather than inventing a new shape. The full conventions — wire format,
handler order, page/data shape, and the `loading.tsx` requirement for every dynamic
dashboard section — are in `docs/ARCHITECTURE.md` → Binding conventions. Read them
before writing a route or a section.

## Gotchas that have already cost time

<!-- Promotion target for docs/ai/lessons-learned.md (see its promotion rule).
Mechanism-level entries only: what breaks, WHY it breaks, and the rule.
Repo-specific lessons only. A lesson that would bite any project on any stack is
promoted to the personal global file instead — see the promotion rule's last route. -->

**`NEXT_PUBLIC_*` must be read statically.** Next inlines them into the client bundle by literal text replacement. `process.env[name]` is never inlined and is `undefined` in the browser — while working perfectly on the server, so API routes keep returning correct responses and mislead you. Write `process.env.NEXT_PUBLIC_FOO` literally.

**Tailwind v4 utilities beat `@layer base`** regardless of specificity. A `text-*` utility overrides a base `a:hover` rule.

**Tailwind v4 `translate-*` sets the CSS `translate` property, not `transform`.** Transitions must name `translate` or nothing animates.

**`animation-fill-mode: both` leaves a transform applied forever**, and a transformed ancestor becomes the containing block for every `position: fixed` descendant. This silently re-anchored the mobile drawer and tab bar to the document instead of the viewport, and only showed up on pages taller than the viewport. Keep entry animations off any element that wraps fixed-position children.

**The dev CSP needs `'unsafe-eval'`; production must not have it.** React uses `eval()` in development. `next.config.ts` gates it on `NODE_ENV`.

**Drizzle silently overwrites postgres.js type parsers, and it cost most of a day.** `drizzle-orm/postgres-js`'s `construct()` replaces `client.options.parsers` for every temporal OID (1184, 1114, 1082, and more) with a transparent `(val) => val` at construction time. So `postgres(url, { types })` is *declared* and then discarded: the config on the `postgres()` call has no effect on anything routed through the Drizzle handle. `lib/db/client.ts` re-asserts the parsers **after** `drizzle()` returns; deleting that loop turns `lib/db/client.test.ts` red. This matters because PostgREST returned timestamps as ISO 8601 (`...T...+00:00`) while postgres.js's native text is `... ...+00`, and `formatDate()` silently renders `—` when `new Date()` yields `NaN` — V8 tolerates the non-ISO form, other engines need not. **Verify any change here through an actual Drizzle handle, never through a bare `postgres()` client** — a probe against a raw client "passed" while production was broken, and that false green survived a review. If you upgrade `drizzle-orm`, re-run that through-the-handle probe.

**`DrizzleQueryError` has no `.code`.** Drizzle wraps every query error, so `error.code` is `undefined` where PostgREST gave you a SQLSTATE — read it off `error.cause` instead (`postgresErrorCode` in `lib/dashboard/api.ts` does). Every `23505`/`23503` → 409 mapping silently stopped firing and returned 500s until this was found. (The logging half of this is an invariant above.)

**Storage objects need their own policy.** RLS on `storage.objects` is separate from the `files_metadata` table. `createSignedUrl()` requires `select`, so an insert/delete-only policy breaks downloads.

**Browser-reported MIME is unreliable.** Windows registers no content type for `.sql` or `.md`, so Chrome sends `application/octet-stream` and a MIME allowlist rejects files whose extension is explicitly permitted.

**Validate redirect targets by resolving them, not by prefix-matching.** `normalizeNextPath` once rejected `//evil.com` but allowed `/\evil.com`, which browsers normalise to `//evil.com` and resolve to another host — an open redirect reachable with zero interaction for a signed-in admin. Resolve against a fixed origin and confirm the origin did not change. Any guard built from `startsWith` on a URL is a guess about how browsers parse; resolution is the answer.

**Auth runs in Server Actions, and the login form is a Server Component.** This is deliberate and load-bearing, not stylistic. Two consequences to respect:

- Next guarantees progressive enhancement for forms calling Server Actions **from Server Components**, but the documented way to show validation errors is a Client Component with `useActionState` — which forfeits that guarantee. Errors therefore travel by redirect (`?error=1`), at the cost of retyping the email. Do not "improve" this into inline errors without understanding what it trades away.
- `redirect()` signals by throwing. It must never sit inside a `try`/`catch`, or the navigation is silently swallowed. Wrap the call you need to guard, and put the redirect after it.

## Verification

Gate every change on `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.

**Check exit codes directly.** `npx tsc --noEmit | tail -2 && echo OK` tests `tail`'s exit code, not tsc's, and will report a false green. This has happened.

**A server that answers is not necessarily your server.** Confirm a port is free and that the ready line came from your own process before trusting a probe — a stale process on the same port has produced misleading passes twice.

**Synthetic events cannot validate touch gestures.** A swipe handler passed twelve synthetic-pointer-event cases and did nothing on a real phone, because synthetic events bypass the browser's gesture arbitration — the exact mechanism that broke it. Touch behaviour needs real hardware.

**Prefer proving a claim to asserting it.** Query the database rather than trusting a 200; fetch the signed URL rather than trusting its shape; read the value that was *stored*, not the one that was returned. Several confidently-stated claims in this project's history were wrong, and one check each would have caught them.

Anything needing a live session or real data is **deferred, not skipped** — record it. Mock data or a fallback path that makes something look done is worse than a truthful deferral.
