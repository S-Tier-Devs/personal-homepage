# AI Decision Records — personal-homepage

This file tracks significant decisions made about AI workflows, tooling, and conventions on this project.  
**Format**: one entry per decision, newest at the bottom. Mark superseded decisions clearly.

---

## Decision Template
```
## [DATE] — [Decision Title]
**Status**: Active | Superseded by [date/title]
**Context**: 
**Decision**: 
**Alternatives considered**: 
**Consequences**: 
**Follow-up tasks**: 
```

---

## 2026-03-29 — AI Markdown File Structure
**Status**: Active  
**Context**: Project uses AI assistance heavily; needed a standard way to capture and reuse learnings across phases and future projects.  
**Decision**: Adopt the VS Code Copilot customization primitive set: `copilot-instructions.md` for always-on baseline, `.instructions.md` files scoped by `applyTo` glob, `.prompt.md` for reusable task prompts, `SKILL.md` for multi-step workflows, and `docs/ai/` for human-maintained knowledge capture.  
**Alternatives considered**: Single monolithic instructions file (too large, hard to maintain); external wiki (not co-located with code).  
**Consequences**: AI files must be updated at every phase close gate. Maintenance cadence: monthly review, post-incident within 48h, quarterly cleanup.  
**Follow-up tasks**: Add AI docs update as required step in each phase definition.

---

## 2026-03-29 — Admin Authentication Method
**Status**: Superseded by 2026-07-21 — Admin Authentication Method (Password + Magic Link)  
**Context**: Site needs a protected admin area for content management and file uploads.  
**Decision**: Use Supabase Auth with Google OAuth. Admin access restricted to an explicit email allowlist (`ADMIN_EMAIL` env var). Single admin account at launch.  
**Alternatives considered**: Magic link email (less friction but less familiar); GitHub OAuth (fewer people have it as primary identity).  
**Consequences**: Admin must have a Google account. If admin email changes, `ADMIN_EMAIL` env var must be updated in Vercel and Supabase RLS policies reviewed.  
**Follow-up tasks**: Document admin email change runbook in `docs/` once auth is implemented.

---

## 2026-03-29 — File Upload Policy
**Status**: Active  
**Context**: Personal homepage needs admin-only file upload/download with controlled scope.  
**Decision**: Allowed extensions: `.pdf`, `.docx`, `.txt`, `.md`, `.sql`, `.py`. Max 10MB per file. All files private by default; public visibility must be explicitly toggled per file. Admin-only uploads via Google-authenticated session.  
**Alternatives considered**: Broader extension list (higher risk surface); public-by-default (accidental exposure risk).  
**Consequences**: Server-side validation required for both extension and MIME type. Supabase Storage bucket must be private. Signed URLs with short TTL for downloads.  
**Follow-up tasks**: Implement MIME+extension validation in upload API route; encode rules in `backend.instructions.md`.

---

## 2026-03-31 — Admin Dashboard Architecture
**Status**: Active  
**Context**: Phase 4 required building an admin dashboard for file management and contact form submission handling.  
**Decision**: Implement admin routes and API endpoints with a shared `requireAdminAuth` middleware that verifies session and admin email. Client-side dashboard is a React component (`"use client"`) with tabbed interface for files and contact submissions. File operations (upload, delete, visibility toggle) use separate HTTP methods on a polymorphic `/api/files/[id]` route. Contact submissions are read-only to admins with status-update capability.  
**Alternatives considered**: Server-side rendered admin dashboard (less interactive); separate file and contact endpoints (more routes to manage).  
**Consequences**: All admin API routes are protected by `requireAdminAuth` which must be called first in each handler. The middleware pattern is reusable for future admin endpoints. Client state is local (React useState) rather than server-cached, so list refreshes after mutations.  
**Follow-up tasks**: Implement optimistic UI updates if performance becomes an issue; consider adding confirmation dialogs for destructive operations; add server-side logging of admin actions for audit trail.

---

## 2026-03-30 — Phase 0 Security and Secret Handling Policy
**Status**: Active  
**Context**: Phase 0 requires a concrete security baseline before Vercel, Supabase, and Google OAuth setup.  
**Decision**: Admin access remains single-user at launch and is controlled by the `ADMIN_EMAIL` environment variable. Files are private by default and require an explicit visibility toggle to become public. Secrets live only in local `.env.local`, Vercel environment variables, or Supabase configuration; they must never appear in committed files, issue bodies, or git remote URLs after use. Upload endpoints will enforce extension allowlist, MIME verification, filename sanitization, and a baseline rate limit even for admin-only traffic.  
**Alternatives considered**: Multi-admin role model at launch (more complexity); public-by-default files (higher accidental exposure risk); storing secrets in repo-level encrypted files (unnecessary for current scope).  
**Consequences**: Auth and storage code can assume least privilege and explicit allowlists. Operational steps must include credential hygiene, including resetting remotes if a token is embedded temporarily.  
**Follow-up tasks**: Implement admin allowlist check in auth guard; add upload rate limiting; document token hygiene in bootstrap guidance.

---

## 2026-03-30 — Data Classification, Retention, and Launch Policy Pages
**Status**: Active  
**Context**: The site will store public content, contact submissions, and private admin-managed files, so data boundaries need to be explicit before schema work starts.  
**Decision**: Public data includes homepage content, projects, blog posts, external project links, and only files explicitly marked public. Private data includes contact form submissions, unpublished content, admin audit metadata, and all storage objects without a public toggle. Sensitive data includes all credentials, OAuth secrets, service-role keys, and any signed URL generation inputs. Contact submissions will be retained for 12 months by default unless legal or operational needs change. A privacy policy is required before production launch; terms of use can remain lightweight but should include a download/use disclaimer if public files are offered.  
**Alternatives considered**: Indefinite retention (higher privacy burden); no privacy page at launch (not appropriate once contact data is stored).  
**Consequences**: Schema and RLS can separate public tables from private tables cleanly. Production launch is gated on a privacy policy page and retention wording.  
**Follow-up tasks**: Reflect public/private split in schema design; add retention note to contact-submission implementation; create privacy page before launch.

---

## 2026-03-30 — Observability, Backup Targets, and Budget Guardrails
**Status**: Active  
**Context**: Phase 0 includes selecting a practical operations baseline that fits a personal site without over-engineering.  
**Decision**: Use Sentry for application error tracking and UptimeRobot for external uptime checks, with Vercel native logs used for deployment/runtime diagnostics. Set baseline recovery targets to RPO 24 hours and RTO 8 hours for launch. Treat Supabase automated backups and periodic exports of critical content/file metadata as the minimum backup posture. Keep the initial deployment on Vercel Hobby and Supabase free or starter tier, with a monthly review of storage growth, bandwidth, and runtime usage before any paid upgrade.  
**Alternatives considered**: Vercel-only monitoring (weaker application-level error workflow); enterprise-grade monitoring stack (too heavy for current scope).  
**Consequences**: Phase 1 and Phase 5 work can integrate a specific alerting stack rather than leaving monitoring undefined. Restore expectations are clear enough for a personal site without promising enterprise SLA behavior.  
**Follow-up tasks**: Add Sentry and uptime-monitoring setup tasks; document manual backup/export steps once schema is in place.

---

## 2026-03-30 — Domain and OAuth Ownership Assumption
**Status**: Active  
**Context**: Platform setup depends on control of the production domain and OAuth provider configuration, but those are external operational assets.  
**Decision**: Proceed under the assumption that the project owner controls `patrickbeasley.com` DNS and can manage the Google OAuth application needed for Supabase Auth production callbacks. Treat explicit verification of that access as an operational checklist item before production configuration is applied.  
**Alternatives considered**: Blocking all setup until ownership is manually re-confirmed (slows progress without changing technical design).  
**Consequences**: Build work can continue, but the Phase 0 operational verification issue stays open until DNS and OAuth access are confirmed.  
**Follow-up tasks**: Confirm registrar/DNS access and Google Cloud project ownership before Vercel custom domain and OAuth callback setup.

---

## 2026-03-30 — Phase 1 Platform Bootstrap Completion Baseline
**Status**: Active  
**Context**: Phase 1 targeted platform readiness: Vercel deployment, Supabase project creation, base schema migration, and env wiring for local + deployed environments.  
**Decision**: Treat Phase 1 implementation as complete once the repo is deployed to Vercel, Supabase project is created, initial migration `202603300001_initial_schema.sql` is applied, and required environment values are available in local runtime and deployment settings.  
**Alternatives considered**: Keeping Phase 1 open until custom domain cutover (mixes platform bootstrap with DNS operations tracked separately).  
**Consequences**: Remaining domain verification work can be tracked independently while Phase 2 auth and app feature work proceeds.  
**Follow-up tasks**: Keep DNS/OAuth ownership verification open as a separate operational gate before production launch.

---

## 2026-03-30 — Phase 2 Auth Foundation Completion Baseline
**Status**: Active  
**Context**: Phase 2 required server-side OAuth flow support, secure redirect handling, and admin access bootstrapping for RLS-based authorization.  
**Decision**: Mark auth foundation complete when Google provider is enabled in Supabase, callback/login routes are implemented in app code, sign-in is validated successfully, and the admin email is inserted into `public.admin_users`.  
**Alternatives considered**: Delaying completion until full admin dashboard exists (moves goalposts into Phase 4 scope).  
**Consequences**: Auth is ready for protected routes and admin features; dashboard and content workflows can proceed without revisiting provider bootstrap.  
**Follow-up tasks**: Add protected admin route guards and session-aware UI as Phase 4 implementation tasks.

---

## 2026-03-31 — Contact Form Anti-Spam Strategy
**Status**: Active  
**Context**: Phase 3 contact form required a decision on spam prevention before implementation.  
**Decision**: Launch with in-memory rate limiting only (3 requests per minute per IP). hCaptcha and Cloudflare Turnstile deferred. If spam volume grows after launch, Turnstile is the preferred addition due to zero-friction UX and free tier availability.  
**Alternatives considered**: hCaptcha at launch (adds friction for genuine users); Turnstile at launch (small additional complexity without evidence of need).  
**Consequences**: Current in-memory rate limit store resets on server restart and does not span multiple Vercel instances. Suitable for personal site traffic; would need Redis-backed store (e.g., Upstash) before horizontal scaling.  
**Follow-up tasks**: Monitor contact submissions in Supabase; add Turnstile if spam submissions appear.

---

## 2026-03-31 — Phase 5 Security Hardening Completion Baseline
**Status**: Active  
**Context**: Phase 5 required HTTP security headers, build gate verification, and smoke test sign-off before the project could be considered launch-ready.  
**Decision**: Treat Phase 5 complete when: all security headers are configured in `next.config.ts`, lint/typecheck/build pass clean, and Playwright smoke tests cover all public pages plus auth/admin guard behavior. Observability (Sentry + UptimeRobot) tracked as a separate post-launch task.  
**Alternatives considered**: Blocking on Sentry setup before closing Phase 5 (delays launch for a non-blocking observability concern).  
**Consequences**: The security headers configuration in `next.config.ts` references `NEXT_PUBLIC_SUPABASE_URL` at build time to set a precise CSP `connect-src` value — if the Supabase URL changes, the header must be regenerated by redeploying.  
**Follow-up tasks**: Set up Sentry and UptimeRobot post-launch (issue #27); confirm DNS and Google OAuth ownership before production deployment (issue #4).

---

## 2026-07-21 — Admin Authentication Method (Password + Magic Link)
**Status**: Active — supersedes 2026-03-29 "Admin Authentication Method"  
**Context**: The owner is the only user and will open the private dashboard daily for years. Google OAuth put a third party in the sign-in path and offered no benefit for a single known identity. Supabase refresh-token rotation (wired through `proxy.ts` → `lib/supabase/middleware.ts`) keeps a trusted device signed in indefinitely, so sign-in should only happen on a new device or after cookies are cleared.  
**Decision**: Sign in with Supabase email + password at `/login` (`signInWithPassword`), with a magic link emailed to the same address as the forgot-password backstop (`signInWithOtp` → `/auth/confirm`). Admin identity is still `ADMIN_EMAIL` at the app layer plus an `admin_users` row at the RLS layer — unchanged. Public sign-ups are disabled server-side in Supabase, and the magic-link call passes `shouldCreateUser: false`, so password auth does not open registration.  
**Alternatives considered**: Keeping Google OAuth (third-party dependency in a daily-use path, and an outage or account change locks the owner out); magic link only (an email round trip on every new device); long-lived API token (no revocation story, worse than a rotating session).  
**Consequences**: The Email provider must be enabled in Supabase and the admin auth user must have a password set, matching `ADMIN_EMAIL` and the `admin_users` row. Session timebox/inactivity expiry must stay OFF to preserve indefinite per-device sessions. `/auth/confirm` must be present in the Supabase redirect allowlist for every environment (local, preview, prod). The magic link relies on the default `{{ .ConfirmationURL }}` email template: the PKCE `?code=` exchange in `/auth/confirm` breaks if the template is switched to `{{ .TokenHash }}`. The Google OAuth routes (`app/auth/login/route.ts`, `app/auth/callback/route.ts`) were deliberately left in place so there is never a window without a working sign-in; they are deleted only after password sign-in is verified.  
**Follow-up tasks**: Enable Email provider and set the admin password in Supabase; add `/auth/confirm` to the redirect allowlist; verify password and magic-link sign-in end to end; then delete the OAuth routes and the `ADMIN_EMAIL`-related Google notes from the runbook.

## 2026-07-21 — Authentication Runs Server-Side (Server Actions, No Browser SDK)
**Status**: Active — refines 2026-07-21 "Admin Authentication Method (Password + Magic Link)" (the method is unchanged; only where it executes changed)  
**Context**: Sign-in was the only place the browser reached past our own `/api/*` layer and called a vendor SDK directly. That made it the one page whose failure is total rather than degraded: if the client bundle does not execute, every other page merely loses interactivity, but login becomes impossible. On 2026-07-21 a corporate web filter (Forcepoint) blocked the JS chunks on a work machine; the form fell back to a native GET submit and serialised the email and password into the query string, from where they reached browser history, Vercel request logs, and a TLS-intercepting proxy. `method="post"` plus a hydration guard (`f383003`) contained the leak, but not the fragility — the same total failure follows from a dropped chunk, a script blocker, an extension throwing before hydration, or an old browser failing to parse the bundle.  
**Decision**: Authenticate in Server Actions (`lib/auth/actions.ts`). `components/auth/login-form.tsx` is a Server Component with no hooks and no SDK; the form posts, the server calls `signInWithPassword` / `signInWithOtp` through `createServerSupabaseClient`, sets the session cookie, and redirects. Failures redirect to `/login?error=1` (credentials) or `?auth_error=` (magic-link landing), each generic within its class. `lib/supabase/browser.ts` is deleted.  
**Alternatives considered**: A hand-rolled POST route handler — rejected because Server Actions carry CSRF origin-checking and documented progressive enhancement, and a route that establishes a session would mean implementing CSRF ourselves. A Client Component with `useActionState` for inline errors — rejected because the framework guarantees progressive enhancement for *Server* Components while prescribing a Client Component for validation errors; choosing inline errors forfeits the very property this change exists to obtain.  
**Consequences**: No Supabase SDK and no anon key ship to the browser — `lib/supabase/browser.ts` was their only client-side consumer. The `router.push()` + `router.refresh()` race is gone, since a server-set cookie precedes a server redirect. The email must be retyped after a failed sign-in without JS, accepted deliberately. `NEXT_PUBLIC_SITE_URL` is now load-bearing: `emailRedirectTo` derives from it rather than `window.location.origin`, because trusting a request `Host` header in an emailed link is a poisoning vector — it must be set per environment or magic links point at the fallback origin. Auth is now one replaceable server module, which also makes a future move off Supabase materially cheaper.  
**Verified**: Sign-in succeeded on the Forcepoint-filtered network that motivated the change. Also verified in production: wrong password redirects to `?error=1`, no credentials appear in any URL, and a browser with no prior session can sign in. **Not verified**: the formal acceptance criterion of every flow with JavaScript explicitly disabled, and magic link end to end.  
**Follow-up tasks**: Set `httpOnly: true` on session cookies — nothing client-side reads them any more, so this is a free reduction in XSS blast radius. Clear the sticky `?error=1` / `?sent=1` params, which persist across a refresh where the old state-based form cleared them. Enforce that `lib/env.ts` stays server-only (needs the `server-only` package); nothing currently prevents a future `"use client"` import from silently re-inlining the anon key with every gate still green.

## 2026-10-22 — Second auth surface: blog API tokens
**Status**: Active  
**Context**: F-013's primary authors are AI agents, not the owner — they need
credentials that are not the owner's session, are individually revocable, and
are attributable in the activity log. Tier stays T0 personal (single human
owner); this adds machine credentials, not user accounts.  
**Decision**: Add `requireBlogAuth` (session OR blog-scoped bearer token)
beside `requireAdminAuth`, used only under `app/api/blog/**`. Tokens are
`pbk_` + 32 random bytes base64url, SHA-256-hashed at rest, soft-revoked
(`revoked_at`, so events keep their reference), with `last_used_at` throttled
to once per minute. If an `Authorization` header is present it must be a
valid, unrevoked, `blog`-scoped token or the request is a 401 — it never
falls back to the cookie session. No rate limiting (256-bit entropy makes
online guessing infeasible) and no token expiry (instant revocation plus
`last_used_at` visibility cover the risk at T0) — both stated decisions, not
gaps.  
**Alternatives considered**: A shared env-var secret (not revocable per-agent,
no attribution in the activity log); Supabase service accounts (deepens the
dependency this project is migrating off); finer per-verb scopes
(`blog:read`, `blog:publish`) now (enforcement without a policy behind it —
the owner decided agents may create, edit, delete and publish; the `scopes`
array keeps finer grants additive later, not a migration).  
**Consequences**: The second auth surface is confined to `app/api/blog/**` by
construction and by test (`lib/auth/blog-guard-scope.test.ts` asserts only
that tree imports `requireBlogAuth`); token routes (`/api/api-tokens/**`)
stay on `requireAdminAuth`, so a token can't create, list, or revoke tokens.
Compatible with migration Phase 3: the session half of the guard swaps from
Supabase to opaque sessions; the token half is unaffected.  
**Follow-up tasks**: Owner runs the infra checklist (Spaces bucket/key, env
vars via the live-spec procedure) before agents can upload media. Verify
revocation live: a revoked token's next request returns 401 (proves the SQL
half of the guard, not just the code path).

---

## 2026-10-22 — Shared editor forces `<p>` as the default paragraph separator
**Status**: Active
**Context**: F-013 final whole-branch review found that typed posts lost
paragraph structure — and merged adjacent lines' words with no separator at
all — because browsers default a contenteditable's per-Enter wrapper to
`<div>`, while the post sanitiser (`buildPostProfile` in `lib/sanitize.ts`) is
`<p>`-first and was dropping unrecognised tags (text kept, tag discarded).
`RichTextEditor` is shared between Notes and the blog editor, so any fix here
is a behaviour change for both surfaces.
**Decision**: On mount, `RichTextEditor` calls
`document.execCommand("defaultParagraphSeparator", false, "p")` (non-fatal —
some browsers may reject the deprecated command, in which case the `<div>`
allowlist fallback below still holds). As a safety net for pasted/legacy
markup and browsers that ignore the command, `buildPostProfile` now also
allowlists bare `<div>` (`NOTE_PROFILE` already allowed it). `.post-body div`
in `app/globals.css` gets the same `margin-block` as `.post-body p`.
**Alternatives considered**: Sanitiser-side only (convert `<div>` to `<p>` at
save time) — rejected because it still lets malformed/merged text reach the
editor's live DOM before the next save, and converting block-level semantics
server-side is lossier than just allowlisting the tag browsers actually emit.
Leaving `<div>` unlisted and accepting the text-merge — rejected outright,
it is a data-loss bug, not a style preference.
**Consequences**: Both Notes and blog posts now store `<p>` for new content
typed after this change (existing stored `<div>`-only content, if any,
continues to render correctly via the allowlist + CSS rule, it just never
gets rewritten to `<p>` on its own). Idempotence of `sanitizePostHtml` is
preserved — `<div>` round-trips byte-for-byte, same as `<p>`.
**Follow-up tasks**: None — this is believed complete. Revisit only if a
browser is found where `defaultParagraphSeparator` silently produces a third
wrapper tag (e.g., `<br>`-only line breaks), which would need its own
allowlist entry.
