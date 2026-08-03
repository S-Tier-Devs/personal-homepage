# Lessons Learned — personal-homepage

This file is the operational memory for AI-assisted development on this project.  
**Update rule**: add an entry after any correction from the user, at the end of every phase, and within 48 hours of any incident or repeated mistake.

**Promotion rule**: if a lesson appears twice — or is clearly load-bearing on first
occurrence — promote it:
- agent-behavior or repo-convention lessons → the **Gotchas that have already cost
  time** section of `AGENTS.md`
- procedure lessons → the relevant skill or prompt file
- architecture lessons → `AGENTS.md` → **Architecture**
- lessons that are **not specific to this repo** — the same mistake would bite any
  project, on any stack — → the **Cross-project gotchas** section of the personal
  global file (`~/.claude/CLAUDE.md`, source `global/user-CLAUDE.md` in the
  ai-standards kit; edit there and run the installer). Promote here on the second
  repo, not the second occurrence within this one — otherwise the same lesson is
  copy-pasted into every repo's AGENTS.md, which is what the global file exists to
  prevent. It must also be a mechanism, not a preference: what breaks, why, and the
  rule.

A promoted lesson stays here as history; the promoted form is what agents load every
session.

---

## Entry Template
```
## [DATE] — [Short Title]
**Phase/Context**: 
**What worked**: 
**What failed**: 
**Root cause**: 
**Reusable rule**: 
**Action to encode**: (AGENTS.md gotcha / skill or prompt / architecture / global CLAUDE.md / none)
```

---

## 2026-03-29 — Project Initialization
**Phase/Context**: Action 0 + Action 1 — repo creation and AI docs scaffold  
**What worked**: Using `gh` CLI with a PAT for repo creation; `create-next-app` with `--yes` flag for non-interactive scaffold  
**What failed**: Initial PAT was missing `read:org` scope — required regeneration  
**Root cause**: GitHub CLI requires `read:org` scope even for personal account operations  
**Reusable rule**: When generating a GitHub PAT for `gh` CLI, always include `repo`, `workflow`, `read:org`, and `project` scopes  
**Action to encode**: Add scope checklist to `.github/skills/project-setup/SKILL.md` Stage 1 (that skill was named `project-bootstrap` when this entry was written)

## 2026-03-30 — Bootstrap Credential Hygiene
**Phase/Context**: Resume after initial scaffold and GitHub setup  
**What worked**: Temporarily embedding the PAT in the git remote unblocked a non-interactive push when credential helper behavior was inconsistent  
**What failed**: `.env.example` was ignored by the default `.env*` gitignore rule, and the temporary credentialed remote needed immediate cleanup  
**Root cause**: Default scaffold ignore rules were broader than needed, and git credential behavior was not fully consistent across terminals  
**Reusable rule**: If a token is ever embedded in a remote URL to unblock automation, reset the remote to a clean URL immediately after push; also verify `.env.example` is force-added or explicitly unignored when the repo ignores `.env*`  
**Action to encode**: Update bootstrap guidance and repo instructions to check `.env.example` staging and remote URL cleanup

## 2026-03-30 — Migration Apply Order Matters
**Phase/Context**: Phase 1 schema apply against remote Supabase database  
**What worked**: Applying migrations with `supabase db push --db-url ... --include-all` and validating with a dry run before and after apply  
**What failed**: Initial migration run failed because `public.is_admin()` referenced `public.admin_users` before the table existed  
**Root cause**: SQL function dependency order in migration file did not match Postgres validation behavior  
**Reusable rule**: In initial schema migrations, create dependency tables before creating functions or policies that reference them  
**Action to encode**: Keep dependency-order checks in migration review prompt and run dry-run before first apply

## 2026-03-30 — OAuth Provider Save Is Not Enough Without Runtime Verification
**Phase/Context**: Phase 2 Google OAuth provider setup and callback validation  
**What worked**: Verifying provider status through `/auth/v1/settings` with anon API key and then running end-to-end sign-in via `/auth/login`  
**What failed**: Assuming provider config was active before checking runtime settings led to a false-complete state  
**Root cause**: Dashboard save state was not validated against the live auth service configuration  
**Reusable rule**: After provider setup, always verify `external.google=true` from auth settings and perform one full login callback test before closing auth tasks  
**Action to encode**: Add provider-status and callback test checklist to bootstrap skill

## 2026-03-31 — Dev Server Startup Fails with "Couldn't Find App Directory" Despite Directory Existing
**Phase/Context**: Phase 3 — Attempted to start dev server for Playwright testing validation  
**What worked**: Verified that `app/` directory exists at correct location via Node fs API and directory listing (`Get-ChildItem app/` showed the folder)  
**What failed**: `npm run dev`, `npx next dev`, and `npx next dev --port 3000` all fail with error "Couldn't find any `pages` or `app` directory"  
**Root cause**: Unknown — likely one of: (a) cached build state issue, (b) TypeScript compiler not finding app dir during sourcemap/type generation, (c) environment variable issue, (d) Next.js 16 specific edge case with Windows paths  
**Reusable rule**: If dev server fails to find app directory despite its existence, try: 1) `rm -r .next .turbo` to clean build cache, 2) verify CWD is correct with `pwd`, 3) check tsconfig.json includes app in compilerOptions, 4) try `npx tsc --noEmit` to validate TypeScript, 5) check for .vercelignore or next.config issues, 6) if persists, this may indicate a deeper toolchain issue needing manual troubleshooting or rebuild  
**Action to encode**: Add "dev server startup troubleshooting" section to `backend.instructions.md` with the above checklist

## 2026-03-31 — Phase 4: Admin Dashboard and File Upload Implementation
**Phase/Context**: Phase 4 — Admin dashboard with file upload/download/management  
**What worked**: Creating modular API route handlers with shared admin guard middleware (`requireAdminAuth`); separating concerns into library function for reuse; using Supabase Storage for files with database metadata tracking; reactive React component with tabbed interface for file and contact submission management; error handling with clear user feedback  
**What failed**: Initial UUID import was incorrect (tried to import `v4` from `crypto` module)  
**Root cause**: Crypto module doesn't export UUID v4 — should use `crypto.randomUUID()` instead  
**Reusable rule**: For file uploads, always validate extension AND MIME type server-side; separate storage operations from metadata tracking so cleanup is consistent if one fails; use `crypto.randomUUID()` for Node.js 16+, or import from `uuid` package for compatibility  
**Action to encode**: Update `backend.instructions.md` with file upload validation pattern and middleware example

## 2026-03-31 — .mjs Files Cannot Use TypeScript Type Annotations
**Phase/Context**: Post-Phase 4 — Verification of script files before use  
**What worked**: Syntax checking with `node --check` identified the invalid script syntax  
**What failed**: `scripts/test-pages.mjs` contained TypeScript type annotations (`: Browser`, `: Page`, `: string[]`) which are not valid in plain JavaScript ES modules  
**Root cause**: File was written with TypeScript syntax despite being a `.mjs` (plain JavaScript) file; also included documentation saying to run with `npx ts-node` when the file is ES module JavaScript  
**Reusable rule**: .mjs files are plain JavaScript ES modules and do NOT support TypeScript syntax. If type annotations are needed, either: (a) rename to `.ts` and run with TypeScript compiler/loader, or (b) keep as `.mjs` and use JSDoc comments for type hints instead of TypeScript annotations. Always verify execution instruction matches file type (`node` for .mjs, `ts-node` for .ts).  
**Action to encode**: Add to `frontend.instructions.md` or create a `.mjs` file guide clarifying the distinction between .ts (TypeScript) and .mjs (plain ES module) files

## 2026-03-31 — Dev Server "Couldn't Find App Directory" Was a Wrong Working Directory
**Phase/Context**: Phase 5 — Attempting to start dev server for Playwright smoke tests  
**What worked**: Running `npx next dev` from `C:\Projects\personal-homepage` — server started in 443ms  
**What failed**: All prior attempts ran `npm run dev` / `npx next dev` from `C:\Projects` (workspace root), not the Next.js project subdirectory  
**Root cause**: VS Code workspace is rooted at `C:\Projects` but the Next.js app lives at `C:\Projects\personal-homepage`; terminal `cwd` defaulted to the workspace root, not the project subfolder  
**Reusable rule**: Always run Next.js CLI commands (`npm run dev`, `npm run build`, `npx next`) from the directory containing `package.json` and `next.config.ts`. In a multi-project workspace, that is the subdirectory, not the workspace root. Verify with `Get-Location` before running.  
**Action to encode**: Add CWD check to quick-start instructions; update dev server troubleshooting entry to include "verify cwd matches package.json location" as the first diagnostic step

## 2026-03-31 — Page Title Template Duplication
**Phase/Context**: Phase 5 — Playwright smoke tests found duplicate branding in page titles  
**What worked**: Playwright `page.title` check immediately caught the bug ("/resume" showed "Resume | Patrick Beasley | Patrick Beasley")  
**What failed**: Phase 3 page files set `title: "Resume | Patrick Beasley"` while the root layout already applies template `"%s | Patrick Beasley"` — resulting in double append  
**Root cause**: When using Next.js metadata template (`template: "%s | suffix"`), page-level titles must NOT include the suffix — the template appends it automatically  
**Reusable rule**: When a root layout defines `metadata.title.template`, all page-level `export const metadata` titles must be the bare page name only (e.g., `"Resume"` not `"Resume | Patrick Beasley"`). The template handles the suffix.  
**Action to encode**: Add to `frontend.instructions.md`: page title must not repeat suffix already defined in layout template

## 2026-03-31 — Contact Form Was Only Logging, Not Persisting
**Phase/Context**: Phase 5 — Security and code review revealed incomplete implementation  
**What worked**: Code review of `app/api/contact/route.ts` caught the TODO comment: "Insert into database via Supabase" with only a `console.log()` in place  
**What failed**: Phase 4 contact form was submitted with just a placeholder — submissions were never saved to the database  
**Root cause**: Implementation was stubbed out with a TODO and placeholder log; the actual Supabase insert was never added  
**Reusable rule**: When reviewing a TODO comment in production code paths, treat it as a bug — never ship with "TODO: implement" in a user-facing API route. Verify each API route actually persists data if persistence is its purpose.  
**Action to encode**: Add to code-review checklist: scan for TODO comments in API routes before closing any phase

## 2026-03-31 — Planning Must Produce GitHub Issues for Execution Tracking
**Phase/Context**: Phase 6 planning and reconciliation across multi-day implementation  
**What worked**: Creating a parent issue plus scoped child implementation issues made progress and reconciliation clear across multiple sessions and commits  
**What failed**: Planning artifacts can drift from execution when issue creation is deferred or skipped  
**Root cause**: Work tracking depended on chat context and docs alone instead of an issue-first execution backbone  
**Reusable rule**: For this repository, planning mode must always generate or update GitHub issues (parent + child tasks) before implementation begins, and keep project board membership/status in sync throughout delivery  
**Action to encode**: Add to `copilot-instructions.md` planning behavior as a non-optional workflow rule

## 2026-04-01 — Homepage UX Pass: Build-Safe Client Helpers and Issue Hygiene
**Phase/Context**: Phase 6 implementation batch for contact form, auth/nav UX, anchor navigation, admin discoverability, and resume removal  
**What worked**: Reusing existing backend/admin APIs and focusing on UI wiring delivered multiple fixes quickly; browser validation confirmed cross-page hash scrolling and contact submit success; issue-per-scope tracking kept execution organized  
**What failed**: Initial hash-scroll helper used `useSearchParams()` and caused a Next.js build-time suspense/prerender error; one GitHub issue body was corrupted by shell escaping while creating long markdown content  
**Root cause**: (1) Global client helper in root layout used a hook that triggers CSR bailout requirements in static generation paths; (2) long multiline issue bodies were passed through an unsafe shell quoting path  
**Reusable rule**: For client utilities mounted in `app/layout.tsx`, prefer minimal hooks (`usePathname`, event listeners) and avoid `useSearchParams` unless wrapped intentionally; for `gh issue create` with long content, use safer body editing patterns (`gh issue edit --body` with a here-string)  
**Action to encode**: Add "layout-mounted client helper hook safety" to Next.js checklist and add a "safe gh issue body" snippet to planning workflow notes

## 2026-07-21 — Tailwind v4: Unlayered Element Rules Silently Beat Every Utility
**Phase/Context**: v2 rebuild Phase 1 — porting the design's base CSS into `app/globals.css`
**What worked**: Reviewing the *built* stylesheet (`.next/static/chunks/*.css`) by brace-depth rather than trusting the source; that is what proved the bug and later proved the fix
**What failed**: The design's bare `a { color: var(--accent) }` was pasted into `globals.css` outside any cascade layer. Tailwind v4 puts utilities in `@layer utilities`, and unlayered author declarations outrank layered ones regardless of specificity — so `text-white` on the accent-colored "Login →" button lost, rendering the label invisible against its own background. `hover:text-*` was dead for the same reason.
**Root cause**: Tailwind v4 is layer-based; v3 habits (bare element selectors in a global sheet) are no longer safe. Nothing in lint, tsc, or build catches it — only visual inspection or reading the compiled CSS.
**Reusable rule**: In Tailwind v4, every global element/base rule must be wrapped in `@layer base { ... }`. When a utility class appears to do nothing, check the compiled CSS for an unlayered rule on the same property before debugging anything else.
**Action to encode**: Add to `frontend.instructions.md`: all global CSS in `globals.css` goes inside a cascade layer.

## 2026-07-21 — Tailwind v4 Translate Utilities Set `translate`, Not `transform`
**Phase/Context**: v2 rebuild Phase 3b — mobile dashboard drawer slide animation
**What worked**: Caught in self-review before commit by checking which CSS property the emitted utility actually sets
**What failed**: `transition-[transform,visibility]` animated nothing, because Tailwind v4's `-translate-x-full` writes the standalone CSS `translate` property rather than a `transform` function
**Root cause**: Tailwind v4 migrated the translate utilities to the individual-transform CSS properties
**Reusable rule**: Transitions involving Tailwind v4 translate utilities must name `translate` (e.g. `transition-[translate,visibility]`), not `transform`
**Action to encode**: Add to `frontend.instructions.md` alongside the cascade-layer rule

## 2026-07-21 — `--read-only=false` Crashes the Supabase MCP Server
**Phase/Context**: Wiring the Supabase MCP server into the project
**What worked**: Reading the installed bundle's `parseArgs` options object to get the real flag list, then starting the server manually to reproduce the failure
**What failed**: `--read-only=false` throws `ERR_PARSE_ARGS_INVALID_OPTION_VALUE: Option '--read-only' does not take an argument` and the server never starts
**Root cause**: `read-only` is declared `{type:"boolean", default:false}` — Node's `parseArgs` rejects a value on a boolean option. Presence means read-only; absence means writable.
**Reusable rule**: For boolean CLI flags, omit the flag to disable rather than passing `=false`. Verify a new MCP server actually starts (pipe an `initialize` JSON-RPC message to it) before assuming the config is good.
**Action to encode**: None — recorded for recall.

## 2026-07-23 — Dynamic App Router Pages Need `loading.tsx` or Navigation Blocks
**Phase/Context**: Owner reported intermittent lag switching between dashboard sections
**What worked**: Diagnosing from the code (systematic-debugging) instead of guessing — traced the per-navigation path (proxy auth → dynamic page render → Supabase/GSD fetch) and checked for a loading boundary (there was none anywhere in the app)
**What failed**: Every `/dashboard/*` page is dynamic (reads cookies + fetches per request), but there was no `loading.tsx`. So the App Router couldn't prefetch the dynamic page, and each client-side navigation blocked on the fetch with no pending UI — the leaving page sat frozen. Latency varied with Supabase/cold-start/GSD, so it presented as *intermittent* lag. (The recent fill-height CSS was suspected but ruled out — it doesn't touch data fetching or navigation.)
**Root cause**: App Router prefetch of a dynamic route only reaches the nearest Suspense boundary. No `loading.tsx` = no useful prefetch = blocking navigation with a frozen previous page.
**Reusable rule**: A dynamic page (per-request server fetch) needs a `loading.tsx` in its segment; it gives an instant, prefetched skeleton and covers the *page* fetch (not the cookie-reading layout). A slow *external* fetch (Tasks → GSD) should additionally stream behind its own `<Suspense>` so navigation itself stays instant. Shape skeletons like the real card + fill-height so the swap is a fill, not a jump.
**Action to encode**: Encoded in `AGENTS.md` (Pages convention) and `frontend.instructions.md` (State and Data Fetching). Tasks streaming follow-up filed in `docs/ai/backlog.md`.
