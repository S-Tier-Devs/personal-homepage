# Agent roster — personal-homepage

<!-- Renamed from .github/AGENTS.md so it stops colliding with the canonical
/AGENTS.md at the repo root, which is the single source of truth for project context,
commands, workflow, invariants, and gotchas. This file is narrower: which agent to
pick, what each may do, and how they hand off. It carries no project rules — if a rule
belongs anywhere, it belongs in /AGENTS.md. -->

## Available Agents

| Agent | Purpose |
|-------|---------|
| Default (Copilot) | General implementation, editing, and Q&A |
| Explore | Read-only codebase exploration and research |

## Agent Selection Matrix

| Task Type | Use |
|-----------|-----|
| Researching options, exploring patterns | Explore (read-only) |
| Implementing features, editing files | Default |
| Planning a phase or approach | Default (plan mode) |
| Reviewing code for bugs/risks | Default with code-review.prompt.md |
| Running a migration | Default with migration.prompt.md |
| Reproducing this project's setup | Default with skills/project-setup/SKILL.md |
| Stamping the agent-instructions kit onto a repo | the global `project-bootstrap` skill |
| Security pass | Default with security-hardening/SKILL.md |
| Pre-release check | Default with release-readiness/SKILL.md |

## Tool Restrictions

- **Explore agent**: read-only — no file creation, no terminal commands, no git operations.
- **Default agent**: full access. Destructive actions (drop table, force push, delete branch) require explicit user confirmation before executing.

## Handoff Protocol
- Planning agents return a structured plan with phases, risks, and open decisions.
- Implementation agents report: what changed, what was verified, and what remains.
- If an implementation step is blocked, state the blocker explicitly rather than guessing.

## Failure and Recovery
- If a command fails, try an alternative approach before asking the user.
- If auth or environment variables are missing, report the exact variable name needed.
- Never retry a destructive command that already failed — escalate to the user.
