---
description: 'Use when I explicitly say ship it / push / open a PR — the commit → push → PR workflow, including the gh Projects-classic REST-API workaround.'
name: 'Ship'
argument-hint: 'Optional: PR title or focus'
agent: 'agent'
---

# Ship: push and open/update a PR

Only run this after I have **explicitly** approved shipping ("push", "ship it",
"force push with lease"). Never push otherwise.

## Preflight

1. Confirm the working tree is committed (`git status`) and the commits use
   conventional prefixes (`feat:`, `fix:`, `chore:`, `test:`, `refactor:`, `docs:`).
2. Run the gate the `pre-push` hook enforces, so the push can't bounce:
   `pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css`.
3. Push the branch (use `--force-with-lease`, never `--force`, if I asked to force).

## PR create / edit — use the REST API, not `gh pr edit`/`gh pr create`

`gh pr edit` and `gh pr create` **fail on this repo** with a fatal
`GraphQL: Projects (classic) is being deprecated` error (a known `gh` bug). Bypass
them with the REST API:

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
# Create:
gh api -X POST "repos/$REPO/pulls" -f title="..." -F body=@body.md -f head="<branch>" -f base="main"
# Edit title/body:
gh api -X PATCH "repos/$REPO/pulls/<n>" -f title="..." -F body=@body.md
```

Write the PR body to a temp `body.md` and pass it with `-F body=@body.md` so
formatting survives. Read-only `gh pr view --json ...` works fine for inspection.

## Report

After pushing, print the PR URL and a one-line summary of what shipped.
