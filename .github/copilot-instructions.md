# Copilot Instructions — personal-homepage

## Purpose and Scope
This workspace is the personal homepage for patrickbeasley.com, built with Next.js (App Router, TypeScript), Tailwind CSS, Supabase (Postgres + Auth + Storage), and deployed on DigitalOcean App Platform. These instructions apply to all AI-assisted work in this repository.

## Non-Negotiables
- Never commit secrets, tokens, or credentials. All secrets go in `.env.local` (git-ignored) or the DigitalOcean App Platform dashboard as `RUN_TIME` secrets - never in `.do/app.yaml`.
- All auth-protected routes and API handlers must verify the session before acting.
- Admin-only behavior must key off the `ADMIN_EMAIL` allowlist on the server side; client-side gating alone is never sufficient.
- File uploads must be validated server-side: allowed extensions (`.pdf`, `.docx`, `.txt`, `.md`, `.sql`, `.py`) and max 10MB per file.
- Contact submissions are private operational data and must not be exposed to public queries or logs.
- Every bug fix must include a regression test.
- Do not skip lint, typecheck, or build verification after changes.

## Code Quality Defaults
- TypeScript strict mode is enabled — no `any` unless justified with a comment.
- Prefer server components and server-side data fetching over client-side where possible.
- Keep components small and focused. Extract reusable logic into `lib/` utilities.
- Follow existing naming conventions: `kebab-case` for files, `PascalCase` for components, `camelCase` for functions/variables.
- Remove dead code and unused imports before committing.

## Planning and Workflow
- When asked to implement: write the minimal diff needed, verify it, and report what was changed and tested.
- See `.github/instructions/workflow.instructions.md` for full planning, verification, and task management guidelines.

## Security and Secrets Handling
- Use `NEXT_PUBLIC_` prefix only for values that are safe to expose to browsers.
- Service-role Supabase keys must only be used in server-side code (`app/api/`, server components, route handlers).
- Validate and sanitize all user-supplied input at the API boundary.
- Remove credentials from git remotes immediately after any temporary token-auth workaround.
- Treat uploaded files as private by default and generate signed URLs for non-public downloads.
- Add a baseline rate limit to contact and upload endpoints even when they are admin-only.

## Verification Expectations
- Run `npm run lint` and `npm run build` after any non-trivial change.
- For web page changes, use Playwright MCP automation (see `frontend.instructions.md` for details).
- See `.github/instructions/workflow.instructions.md` for full verification checklist.

## Output Formatting
- Keep explanations brief. Lead with what changed and why, not a summary of what was read.
- Use inline code for file paths and symbol names.
- Provide a bulleted list of follow-up tasks if any dependencies remain unresolved.

## Knowledge Capture
- After fixing bugs or receiving corrections, update `docs/ai/lessons-learned.md` and promote actionable lessons to the relevant `.instructions.md` file.
- See `.github/instructions/workflow.instructions.md` for the full self-improvement loop.

## Escalation Rules
- If a change would affect the production database schema, pause and confirm before executing.
- If a change modifies auth or RLS policies, flag it explicitly for review before merging.
- If a production credential, OAuth secret, or signed URL handling flow changes, flag it explicitly for review before merging.
