<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

The repo runs **Next.js 16** and **Tailwind CSS v4**. Both differ from what you likely remember. Route handler signatures, `params`, and CSS layering are the usual places this bites.

## Architecture

Public one-pager at `/`, private dashboard at `/dashboard`. Supabase provides Postgres, auth and storage. See `README.md` for the data model and auth design.

**`design/patrick-beasley.dc.html` is the behavioural spec.** Cite its line numbers; do not paraphrase it from memory.

## Deploy target

DigitalOcean App Platform, app `personal-homepage`, region `nyc`. `.do/app.yaml` is the source of truth for the app spec - **never edit the app in the DO web console**, or the console and the spec drift. Production deploys from `main` on merge (`deploy_on_push: true`).

The spec declares four env vars: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at `BUILD_TIME` (Next.js inlines `NEXT_PUBLIC_*` at build time), plus `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAIL` at `RUN_TIME`. Only `SUPABASE_SERVICE_ROLE_KEY` is a secret: it bypasses RLS, so it is `type: SECRET`, empty in the committed spec, and set out of band. `ADMIN_EMAIL` is a plain spec value; it is the contact address this site publishes and is only compared against an already-authenticated session, so it is not sensitive and belongs in the spec so the app is reproducible from it.

### Never apply the committed spec directly

`.do/app.yaml` is the source of truth for *review*, but **two of its values are deliberately blank and applying the file overwrites the live ones with empty**. Verified, not assumed: `doctl apps propose --app <id> --spec .do/app.yaml` returns a 63-character `EV[...]` blob for `SUPABASE_SERVICE_ROLE_KEY` where the real value is ~355. App Platform encrypts the empty string and stores it, so the dashboard shows a populated-looking secret and every health check stays green while admin requests throw.

To change the app config, edit the **live** spec rather than the committed one:

```bash
doctl apps spec get <app-id> > /tmp/live.yaml   # carries real values
# edit /tmp/live.yaml
doctl apps propose --app <app-id> --spec /tmp/live.yaml --output json   # dry run, check envs
doctl apps update <app-id> --spec /tmp/live.yaml
```

Then mirror the structural change back into `.do/app.yaml`, keeping the blank values blank. `doctl apps propose` is non-destructive and is the right way to check any spec change before applying it.

Routine code changes need none of this: `deploy_on_push` rebuilds from `main` and does **not** apply the repo spec.

### Migration leftovers (moved off Vercel 2026-07-26)

True now, and not visible from the code:

- **`www.patrickbeasley.com` is canonical and the apex redirect lives in the app spec, not DNS.** App Platform ALIAS domains *serve* rather than redirect, unlike Vercel, so the apex-to-www 308 is an `ingress` rule in `.do/app.yaml`. Nothing in DNS reveals it. Recreate the app from a spec lacking that rule and both hosts start serving identical content, breaking the canonical assumption `getSiteUrl()` in `lib/env.ts` depends on for magic-link redirects.
- **A new subdomain will NOT reach this app.** `*.patrickbeasley.com` still points at Vercel as the rollback path, so `anything.patrickbeasley.com` resolves to Vercel. Only the apex and `www` are on DO. A real subdomain needs adding to the app spec *and* an explicit Cloudflare record that beats the wildcard.
- **The Vercel project still exists and is still connected to this repo.** Pushes still trigger Vercel builds and PRs still get a Vercel preview URL. Those are the *old* host, not a preview of production, and they vanish at teardown.
- **`disable_email_obfuscation: true` is load-bearing.** App Platform fronts with Cloudflare, which otherwise rewrites the contact `mailto:` into `/cdn-cgi/l/email-protection`. Removing the flag silently breaks the site's primary call to action for JavaScript-disabled visitors. Note the flag only takes effect on the deployment *after* the one that sets it.
- **CAA records restrict issuance** to `pki.goog`, `sectigo.com`, `letsencrypt.org`. App Platform issues via Google Trust Services (`pki.goog`) - that is why new hostnames work, and narrowing CAA would break them silently.
- Supabase is unchanged and the domain did not change, so the auth redirect allowlist needed no edit.

Rollback for the whole hosting move is DNS-only: apex -> `f659688722b302e8.vercel-dns-017.com`, `www` -> `cname.vercel-dns-016.com`, both DNS-only. That apex target is domain-specific; jennsbeans.com uses a different one and swapping them serves the wrong site with no error. Nothing on Vercel has been torn down.

## Binding conventions

`components/dashboard/links/` and `app/api/links/` are the reference implementation. Mirror them rather than inventing a new shape.

**Wire format.** Failures are `{ error: "MACHINE_CODE", message: "human text" }` via `apiError()`. Successes return the bare entity for create (201) and update (200), `{ ok: true }` for delete, and one named collection key for lists (`{ links }`, `{ notes }`).

**Handlers.** `requireAdminAuth(request)` is the *first* statement of every route handler — before `params` is awaited and before the body is read. Params are `{ params: Promise<{ id: string }> }`, then `const { id } = await params`. Guard `[id]` with `isUuid` so a malformed id is a 404, not a Postgres `22P02` surfacing as a 500.

**Pages.** Server page fetches, then hands plain arrays to a `"use client"` view. No data-fetching library. No `useEffect` state synchronisation — derive from props each render. Optimistic updates use plain `useState` plus a rollback closure.

**Every dashboard section is dynamic (per-request fetch), so it needs a `loading.tsx`.** Without a Suspense boundary in the segment, the App Router cannot prefetch the dynamic page and a client-side navigation blocks on that fetch showing *no* pending UI — the section you are leaving sits frozen until the data resolves, which reads as intermittent lag. `app/dashboard/loading.tsx` gives every section one instant, prefetched skeleton; keep it, and shape any new skeleton like the real card (and its fill-height) so the swap is a fill, not a jump. `loading.tsx` covers the *page* fetch, not the cookie-reading layout — that is exactly the sibling-navigation cost. A page whose data is a slow *external* call (Tasks → Project-GSD) should additionally stream that call behind its own `<Suspense>`, so the navigation itself stays instant and only the list area shows the fallback.

**Workspace scoping.** Links and Notes filter by the active workspace. **Documents and Settings do not.** This is the single most common mistake here: an agent pattern-matching on Links adds `useWorkspace()` filtering and silently builds the wrong thing.

## Gotchas that have already cost time

**`NEXT_PUBLIC_*` must be read statically.** Next inlines them into the client bundle by literal text replacement. `process.env[name]` is never inlined and is `undefined` in the browser — while working perfectly on the server, so API routes keep returning correct responses and mislead you. Write `process.env.NEXT_PUBLIC_FOO` literally.

**Tailwind v4 utilities beat `@layer base`** regardless of specificity. A `text-*` utility overrides a base `a:hover` rule.

**Tailwind v4 `translate-*` sets the CSS `translate` property, not `transform`.** Transitions must name `translate` or nothing animates.

**`animation-fill-mode: both` leaves a transform applied forever**, and a transformed ancestor becomes the containing block for every `position: fixed` descendant. This silently re-anchored the mobile drawer and tab bar to the document instead of the viewport, and only showed up on pages taller than the viewport. Keep entry animations off any element that wraps fixed-position children.

**The dev CSP needs `'unsafe-eval'`; production must not have it.** React uses `eval()` in development. `next.config.ts` gates it on `NODE_ENV`.

**Never revoke `EXECUTE` on `public.is_admin()`.** RLS policy expressions run in the *querying* role's security context, so revoking breaks every admin query. The `PUBLIC` grant also hides behind a bare `=X` in `proacl`, so a `has_function_privilege` check filtered over `pg_roles` will not see it.

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
