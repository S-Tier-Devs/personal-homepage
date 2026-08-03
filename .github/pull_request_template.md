## Summary

<!-- What and why, briefly. Link the spec/plan if this came through the SDD cycle. -->

## Docs ownership checklist

Per the table in `docs/CONTRIBUTING.md` — check each that applies and confirm the
owning doc was updated **in this PR**:

- [ ] User-visible change → `CHANGELOG.md` entry (+ version if releasing)
- [ ] Feature scope/status changed → `docs/FEATURES.md` row updated
- [ ] Architecture boundary/stack/invariant changed → `docs/ARCHITECTURE.md`
- [ ] Workflow/convention/gotcha learned → `AGENTS.md` and/or `docs/CONTRIBUTING.md`
- [ ] Correction or incident during this work → `docs/ai/lessons-learned.md` entry
- [ ] None of the above apply

## Verification

- [ ] Local gate green: lint, typecheck, tests, build (e2e where relevant)
- [ ] CI `gate` check green
