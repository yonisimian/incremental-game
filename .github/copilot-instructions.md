# Copilot Instructions

Deep architecture, commands, and conventions live in [CLAUDE.md](../CLAUDE.md) and `docs/`.
This file is the always-loaded guardrail set — keep it short. Heavier guidance is
**deferred** so it only enters context when relevant (see the customization map below).

## Customization map

| Need                   | Where                                          | Loads                    |
| ---------------------- | ---------------------------------------------- | ------------------------ |
| Guardrails (this file) | `.github/copilot-instructions.md`              | always                   |
| Write a feature plan   | `/plan` → `.github/prompts/plan.prompt.md`     | on invoke                |
| Red-team review        | `/review` → `.github/prompts/review.prompt.md` | on invoke                |
| Commit → push → PR     | `/ship` → `.github/prompts/ship.prompt.md`     | on invoke                |
| `shared/` conventions  | `.github/instructions/shared.instructions.md`  | editing `shared/src/**`  |
| `client/` conventions  | `.github/instructions/client.instructions.md`  | editing `client/src/**`  |
| `server/` conventions  | `.github/instructions/server.instructions.md`  | editing `server/src/**`  |
| Test-tier boundaries   | `.github/instructions/testing.instructions.md` | editing tests / `e2e/**` |

## Hard rules (never violate)

- **Commit locally, never push** without explicit approval. Use conventional prefixes: `feat:`, `fix:`, `chore:`, `test:`, `refactor:`, `docs:`.
- **Never rewrite pushed history.** Once a commit is on the remote, don't `--amend`,
  rebase, or squash it — add a new commit and a normal (fast-forward) push instead.
  Force-pushing a shared branch requires explicit approval and a stated reason.
- **When in doubt, ask** rather than assume.

## Workflow

Plan → user approves → implement (commit locally, self-review via `git diff HEAD~1`) →
user approves → ship (only when the user explicitly says so). For a full written plan,
see `/plan`.

**Tests:** while iterating, run only the affected package's suite
(`pnpm --filter <pkg> test`). Run the full `pnpm build` + all suites once, before
declaring an implementation done — not on every edit.

**Which tier:** write a test at the **lowest tier where it can fail truthfully**.
Pure values/strings → logic unit (node). A live DOM node (append/class/event/
cleanup) → DOM unit (`*.dom.test.ts`, happy-dom). A real boundary — the WS, server
authority, the round clock, two players, real layout → e2e (Playwright). For UI
wiring the test is: does the assertion **cross the client/server boundary**? No →
DOM unit; yes → e2e. Full framework: `.github/instructions/testing.instructions.md`.

## Default stance

Be honest over agreeable. When assessing a plan or design: lead with a one-line
verdict, back claims with a reason or code reference, skip empty praise, and treat
added complexity as a cost to the next dev. For a full red-team review (verdict
format, break-it-first, fun check), invoke `/review`.

## Quick reference (detail in [CLAUDE.md](../CLAUDE.md))

- **Build:** `pnpm build` — **Test:** `pnpm --filter <pkg> test`
- **`gh pr edit` / `gh pr create` are BROKEN here** (Projects-classic bug). Use the REST API:
  `gh api -X PATCH "repos/{owner}/{repo}/pulls/{n}" -f title="..." -F body=@body.md`
  (or `-X POST .../pulls` to create). Read-only `gh pr view --json ...` works.
