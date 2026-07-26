---
name: release-readiness
description: Use before deploying to production — verifies build, tests, env parity, domain, auth callbacks, and smoke tests. Trigger phrases: release check, ready to deploy, pre-release, launch checklist.
---

# Release Readiness Skill

## Use When
- Before any production deployment
- After a major phase completes
- As the Phase 5 close gate

## Required Release Gates (all must pass)

### Build and Quality
- [ ] `npm run lint` passes with no errors
- [ ] `npm run build` completes successfully
- [ ] `npm test` passes with no failures or skipped critical tests
- [ ] No TypeScript errors (`npx tsc --noEmit`)

### Environment Parity
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct `BUILD_TIME` values in `.do/app.yaml`; `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAIL` are set as `RUN_TIME` secrets in the DigitalOcean dashboard
- [ ] `NEXT_PUBLIC_SUPABASE_URL` points to production Supabase project (not local/staging)
- [ ] `ADMIN_EMAIL` is set to the correct production admin address
- [ ] No development-only flags or debug logging enabled in production build

### Database and Migrations
- [ ] All pending migrations applied to production Supabase
- [ ] RLS policies verified on production (test unauthenticated access)
- [ ] No pending schema changes that conflict with deployed code

### Domain and Routing
- [ ] `patrickbeasley.com` DNS records point to the DigitalOcean App Platform app; apex redirects to `www.patrickbeasley.com` per the ingress rule in `.do/app.yaml`
- [ ] SSL certificate active and auto-renewing
- [ ] `www.` redirect configured if needed
- [ ] All internal links use relative paths or the production domain

### Auth
- [ ] Supabase Auth redirect URLs include the production domain's `/auth/confirm`
- [ ] Admin **password** sign-in tested end-to-end on the production URL
- [ ] Admin **magic-link** sign-in tested end-to-end on the production URL
- [ ] Public sign-ups are disabled, and `public.admin_users` contains only the intended address

### File Upload/Download
- [ ] Upload tested with allowed and disallowed file types
- [ ] Signed download URL generation tested
- [ ] Supabase Storage bucket policies verified (private by default)

## Smoke Test Matrix

| Test | Expected Result |
|------|----------------|
| Load homepage | 200, content visible |
| Load /projects | 200, projects listed |
| Load /blog | 200, posts listed |
| Submit contact form | Success message, entry in Supabase |
| Admin login (Google OAuth) | Redirects to admin dashboard |
| Non-admin login attempt | Redirected away from admin routes |
| Upload allowed file type | Success, file appears in list |
| Upload disallowed file type | Error message shown |
| Download private file as admin | File downloads successfully |
| Download private file as anonymous | Access denied |

## Rollback Readiness
- [ ] Previous working deployment is identifiable in the DigitalOcean App Platform dashboard
- [ ] Rollback to a previous DigitalOcean App Platform deployment tested (requires no schema rollback)
- [ ] If schema changed, rollback SQL is documented in migration file

## Release Notes Template
```
## Release — [date]
### What's new
-
### fixes
-
### AI docs updated
- lessons-learned.md: [yes/no — summary]
- decision-records.md: [yes/no — summary]
```
