# Architecture

<!-- The system map for anyone new to the repo, human or agent. This file absorbs
the detail that would otherwise bloat AGENTS.md: package boundaries, data flow,
key abstractions, and WHY the shape is what it is. Feature-level detail still
belongs in dated specs under docs/superpowers/specs/ — link them from here. -->

## Overview

A public one-pager at `/` and a private admin dashboard at `/dashboard`, built on
**Next.js 16** and **Tailwind CSS v4**. Both differ materially from earlier major
versions — route handler signatures, `params`, and CSS layering are where that bites.

`design/patrick-beasley.dc.html` is the behavioural spec for the public page. Cite its
line numbers; do not paraphrase it from memory.

**The backend is mid-migration off Supabase onto DigitalOcean.** As of 2026-07-30
Phase 1 has shipped:

- **Data lives in DigitalOcean Managed Postgres**, database `homepage` on the shared
  `apps-pg` cluster (which also hosts `gsd`), reached through Drizzle ORM over the
  `postgres` driver. `lib/db/schema.ts` is the schema, `lib/db/client.ts` the handle,
  `drizzle/` the committed migrations, `npm run db:generate` / `npm run db:migrate`
  the workflow. **There is no RLS** — `requireAdminAuth` is the single authorization
  choke point, deliberately (spec
  `docs/superpowers/specs/2026-07-29-supabase-to-digitalocean-phase-1-data-design.md`).
- **Supabase still provides auth** (session verification via `@supabase/ssr` + local
  JWKS) **and storage bytes** for Documents. Both move in later phases. Files routes
  are deliberately dual-client: metadata through Drizzle, bytes through Supabase.
- Supabase's Postgres is retained as the rollback target, frozen at cutover copy time,
  until the auth phase lands.

## Packages / boundaries

- `app/` — routes. `app/api/*` route handlers, `app/dashboard/*` private sections,
  `app/auth/*` and `app/login` the sign-in flow.
- `components/dashboard/links/` and `app/api/links/` are the **reference
  implementation**. Mirror them rather than inventing a new shape.
- `lib/db/` — Drizzle schema, client handle, and the type-parser re-assertion that
  `lib/db/client.test.ts` guards.
- `lib/auth/` — `requireAdminAuth`, the single authorization choke point.
- `lib/dashboard/` — shared API helpers including `postgresErrorCode` and
  `logQueryError`.
- `design/` — the behavioural spec for the public page.

The conventions that govern wire format, handlers, pages, and loading boundaries are
in **Binding conventions** below — read them before writing a route or a section.
`AGENTS.md` carries the pointer and the invariants that must hold regardless.

## Data model

`lib/db/schema.ts` is the schema of record; `drizzle/` holds committed migrations. Do
not duplicate the schema here.

Workspace scoping is not uniform, and this is the single most common mistake in the
repo: **Links and Notes filter by the active workspace; Documents and Settings do
not.**

## Binding conventions

`components/dashboard/links/` and `app/api/links/` are the reference implementation.
Mirror them rather than inventing a new shape.

**Wire format.** Failures are `{ error: "MACHINE_CODE", message: "human text" }` via
`apiError()`. Successes return the bare entity for create (201) and update (200),
`{ ok: true }` for delete, and one named collection key for lists (`{ links }`,
`{ notes }`).

**Handlers.** Params are `{ params: Promise<{ id: string }> }`, then
`const { id } = await params`. Guard `[id]` with `isUuid` so a malformed id is a 404,
not a Postgres `22P02` surfacing as a 500.

**Pages.** Server page fetches, then hands plain arrays to a `"use client"` view. No
data-fetching library. No `useEffect` state synchronisation — derive from props each
render. Optimistic updates use plain `useState` plus a rollback closure.

**Every dashboard section is dynamic (per-request fetch), so it needs a
`loading.tsx`.** Without a Suspense boundary in the segment, the App Router cannot
prefetch the dynamic page and a client-side navigation blocks on that fetch showing
*no* pending UI — the section you are leaving sits frozen until the data resolves,
which reads as intermittent lag. `app/dashboard/loading.tsx` gives every section one
instant, prefetched skeleton; keep it, and shape any new skeleton like the real card
(and its fill-height) so the swap is a fill, not a jump. `loading.tsx` covers the
*page* fetch, not the cookie-reading layout — that is exactly the sibling-navigation
cost. A page whose data is a slow *external* call (Tasks → Project-GSD) should
additionally stream that call behind its own `<Suspense>`, so the navigation itself
stays instant and only the list area shows the fallback.

## Deployment

Runs on **DigitalOcean App Platform** — app `personal-homepage`, region `nyc`.
`.do/app.yaml` is the source of truth for the app spec. Production deploys from `main`
on merge (`deploy_on_push: true`).

| Piece | Service | Notes |
|---|---|---|
| App | App Platform | spec at `.do/app.yaml`; never edit in the web console |
| Database | Managed Postgres | database `homepage` on shared `apps-pg` cluster; **public** hostname, `sslmode=require` |
| Auth + storage | Supabase | session verification and Documents bytes, pending later migration phases |
| Secrets | App spec `type: SECRET` | blank in the committed spec, set out of band |

### Env vars in the spec

`DATABASE_URL` was added 2026-07-30 for the Postgres migration: `RUN_TIME`,
`type: SECRET`, blank in the committed spec, using the cluster's **PUBLIC** hostname.

The spec otherwise declares four env vars: `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` at `BUILD_TIME` (Next.js inlines `NEXT_PUBLIC_*` at
build time), plus `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAIL` at `RUN_TIME`. Only
`SUPABASE_SERVICE_ROLE_KEY` is a secret: it bypasses RLS, so it is `type: SECRET`,
empty in the committed spec, and set out of band. `ADMIN_EMAIL` is a plain spec value;
it is the contact address this site publishes and is only compared against an
already-authenticated session, so it is not sensitive and belongs in the spec so the
app is reproducible from it.

### Never apply the committed spec directly

`.do/app.yaml` is the source of truth for *review*, but **two of its values are
deliberately blank and applying the file overwrites the live ones with empty**.
Verified, not assumed: `doctl apps propose --app <id> --spec .do/app.yaml` returns a
63-character `EV[...]` blob for `SUPABASE_SERVICE_ROLE_KEY` where the real value is
~355. App Platform encrypts the empty string and stores it, so the dashboard shows a
populated-looking secret and every health check stays green while admin requests
throw.

To change the app config, edit the **live** spec rather than the committed one:

```bash
doctl apps spec get <app-id> > /tmp/live.yaml   # carries real values
# edit /tmp/live.yaml
doctl apps propose --app <app-id> --spec /tmp/live.yaml --output json   # dry run, check envs
doctl apps update <app-id> --spec /tmp/live.yaml
```

Then mirror the structural change back into `.do/app.yaml`, keeping the blank values
blank. `doctl apps propose` is non-destructive and is the right way to check any spec
change before applying it.

Routine code changes need none of this: `deploy_on_push` rebuilds from `main` and does
**not** apply the repo spec.

### Migration leftovers (moved off Vercel 2026-07-26)

True now, and not visible from the code:

- **`www.patrickbeasley.com` is canonical and the apex redirect lives in the app spec,
  not DNS.** App Platform ALIAS domains *serve* rather than redirect, unlike Vercel, so
  the apex-to-www 308 is an `ingress` rule in `.do/app.yaml`. Nothing in DNS reveals
  it. Recreate the app from a spec lacking that rule and both hosts start serving
  identical content, breaking the canonical assumption `getSiteUrl()` in `lib/env.ts`
  depends on for magic-link redirects.
- **A new subdomain will NOT reach this app, and there is no Vercel fallback behind it
  any more.** `*.patrickbeasley.com` no longer points at Vercel — the wildcard CNAME
  was deleted 2026-07-27 and `anything.patrickbeasley.com` is now NXDOMAIN. Only the
  apex and `www` are on DO. A real subdomain needs adding to the app spec *and* an
  explicit Cloudflare record.
- **The Vercel project no longer exists.** It was deleted 2026-07-27. Pushes no longer
  trigger Vercel builds and PRs no longer get a Vercel preview URL.
- **`disable_email_obfuscation: true` is load-bearing.** App Platform fronts with
  Cloudflare, which otherwise rewrites the contact `mailto:` into
  `/cdn-cgi/l/email-protection`. Removing the flag silently breaks the site's primary
  call to action for JavaScript-disabled visitors. Note the flag only takes effect on
  the deployment *after* the one that sets it.
- **CAA records restrict issuance** to `pki.goog`, `sectigo.com`, `letsencrypt.org`.
  App Platform issues via Google Trust Services (`pki.goog`) — that is why new
  hostnames work, and narrowing CAA would break them silently.
- Supabase is unchanged and the domain did not change, so the auth redirect allowlist
  needed no edit.

**The Vercel rollback was removed 2026-07-27** (wildcard CNAME and the
`personal-homepage` Vercel project both deleted), so there is no DNS flip that restores
service any more. If App Platform ever needs to be abandoned, recovery is a **redeploy
of this repo onto App Platform** (or a new host) from `main`, not a DNS change — the
site is reproducible from source, not from a standby deployment. The domain
registration itself is unaffected by any of this and is still held at Vercel; see the
registrar notes in the migration repo for that separate, ongoing thread.
