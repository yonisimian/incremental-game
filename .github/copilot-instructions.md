# Copilot Instructions

## Workflow

Every feature or non-trivial change follows this cycle:

1. **Plan** — When the user describes a feature, write a plan in a dedicated markdown file (e.g. `PLAN.md`, or a new section in `DESIGN.md` — whichever fits best). Do NOT write any production code yet. Tests, types, pseudocode in the plan are fine.
2. **Review plan** — Present the plan and wait for explicit approval ("go", "implement", "looks good", etc.) before proceeding. Iterate if requested.
3. **Implement** — After plan approval, implement the feature. Commit locally but do NOT push. Then self-review the commit (run `git diff HEAD~1`) and report findings.
4. **Review code** — Wait for the user to approve the implementation. Iterate (amend) if changes are requested. Re-run tests after every change.
5. **Ship** — Only push when the user explicitly asks (e.g. "push", "force push with lease", "ship it").

## Rules

- **Never push** to remote without explicit user approval.
- **Never start coding** before the plan is approved. Asking clarifying questions is fine.
- **Never skip tests** — run `pnpm build` and all test suites before marking implementation as ready.
- **Commit conventions** — use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `test:`, `refactor:`, `docs:`.
- **When in doubt, ask** rather than assume.

## Project Context

- **Stack**: TypeScript monorepo (pnpm workspaces) — `shared/`, `server/`, `client/`
- **Build**: `pnpm --filter @game/shared build && pnpm --filter client build && pnpm --filter server build`
- **Test**: `pnpm --filter server test && pnpm --filter client test`
- **Deploy**: Render (static site + web service), configured via `render.yaml`
- **Remote**: `git@github.com:yonisimian/incremental-game.git` (SSH)
