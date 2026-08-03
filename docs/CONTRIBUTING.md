# Contributing

The workflow and freshness contract for personal-homepage — for any contributor (human
or agent) who wasn't in the room when a decision got made. If you only read one
section, read **Docs ownership** at the bottom: it's the mechanism that keeps this repo
honest.

## Quick start

```bash
npm install
cp .env.example .env.local     # the drizzle scripts read .env.local, not .env
npm run dev                    # http://localhost:3000
```

There is **no local Postgres container**. `DATABASE_URL` points at the DigitalOcean
Managed Postgres `homepage` database over the cluster's **public** hostname with
`sslmode=require` — the private hostname is unroutable from outside the VPC and fails
with `CONNECT_TIMEOUT` after a long hang. Your workstation IP must be in the cluster's
trusted-sources list.

Then run the full local gate — the same checks CI runs on every PR:

```bash
npm run lint
npx tsc --noEmit               # typecheck has no npm script
npm test
npm run build
```

## PR flow

1. Branch from `main`: `feat/<name>` (or `fix/<name>`). Never commit directly to main.
2. Push and open a PR: `git push -u origin feat/<name>` then `gh pr create`.
3. Wait for the CI check to go green (`gh pr checks --watch`). The workflow is named
   **CI** (`.github/workflows/ci.yml`), job `validate`.
4. Merge once green. Linear history — squash or fast-forward, matching the existing
   history (`git log --oneline main`).

Merging to `main` **deploys to production** — App Platform has `deploy_on_push: true`
and there is no staging environment. There is no DNS rollback since the Vercel project
was deleted; recovery is a redeploy from `main`.

## Release procedure

1. Bump the version in `package.json` and add a matching section to `CHANGELOG.md` in
   the same PR.
2. Merge through the normal PR flow; the deploy runs from `main` automatically.
3. Mark shipped rows in `docs/FEATURES.md` and add the release to `docs/ROADMAP.md`
   history.

Config changes are **not** part of this flow. `.do/app.yaml` is reviewed in the repo
but never applied from it — see `docs/ARCHITECTURE.md` → Never apply the committed spec
directly.

## Feature intake

Every idea, review finding, or piece of user feedback gets a row in
`docs/FEATURES.md` **before** it gets built:

1. Add a row under **Unassigned** using the template at the top of that file.
2. Periodically, accepted rows get grouped into the next phase and marked
   `assigned (vX.Y)`.
3. The phase goes through the normal cycle: brainstorm → spec (with a mockup if it
   touches UI) → plan → subagent-driven implementation → PR → release.

Long-form deferred work lives in `docs/ai/backlog.md` — items written so a future
session can pick them up cold. A backlog item still needs a `docs/FEATURES.md` row;
the row is the index, the backlog entry is the detail.

## Docs ownership

The mechanism that keeps documentation from drifting: every PR's checklist
(`.github/pull_request_template.md`) asks "did you update the doc that owns this?"
Use this table to answer that question.

| When you change… | You must update… |
|---|---|
| Anything user-visible | CHANGELOG.md (+ version if releasing) |
| Feature scope/status | docs/FEATURES.md row |
| Architecture boundaries, stacks, invariants | docs/ARCHITECTURE.md |
| Deploy config, env vars, infra | docs/ARCHITECTURE.md → Deployment (and `.do/app.yaml` for structure) |
| Workflow/conventions/gotchas | AGENTS.md and/or docs/CONTRIBUTING.md |
| A correction or incident happened | docs/ai/lessons-learned.md (promote per its rule) |
| Deferred work understood but unscheduled | docs/ai/backlog.md + a docs/FEATURES.md row |
| An architectural choice worth not relitigating | docs/ai/decision-records.md |
| Release shipped | docs/ROADMAP.md history |
