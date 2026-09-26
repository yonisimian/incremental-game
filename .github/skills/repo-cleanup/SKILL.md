---
name: repo-cleanup
description: 'Periodic repo-wide hygiene pass for this monorepo (every month or two). Use when asked to clean up slop, dedupe code, find unused/dead code, simplify, merge near-identical helpers/CSS, or scrub comments that narrate history, abandoned designs, or plan IDs (D17, Phase-N). Produces a verified findings report, then one branch with one commit per theme.'
argument-hint: 'Optional focus: a package (shared/server/client/dev) or a theme (dupes, comments, css, dead code)'
---

# Repo cleanup pass

The goal is a smaller codebase that's easier for the next person to change.
This is **not** a pass to add abstractions: a new helper has to remove more
than it adds.

**In scope:** duplication, near-identical helpers or CSS, dead code, needless
indirection, and comments that describe code that doesn't exist.
**Out of scope** (list them in the report, don't change them): gameplay or
balance data (`shared/trees/`), renames based on taste, TODOs that need an
owner decision, and new dependencies.

## Ground rules (from the first run)

1. **Verify every lead before reporting it.** About half of the subagent
   leads were false: selectors that were already grouped, classes that looked
   dead but were built dynamically, a "used once" symbol with 10 call sites,
   formatters that differ on purpose. Grep the usages and diff the copies.
2. **Drifted copies are the prize.** When one copy has a fix or guard the other
   lacks, merging it is a bug fix. Add a test that fails on the old code
   (check with `git stash`).
3. **Comments: trust the script and your own reading over subagents.**
   Subagents found about 3 of about 30 ghost comments.
4. **Keep it proportionate.** Report at most about 8 items, ranked by
   bugs-exposed × lines-removed. Put the rest in the log's backlog.

## Procedure

1. **Read [the log](./references/log.md).** Standing rejections stay rejected
   unless there's new evidence. Start from its backlog.
2. **Scan:** `bash .github/skills/repo-cleanup/scripts/scan.sh [section...]`
   (sections: `unused clones dupes ghosts planrefs todos big`). `clones`
   (jscpd) is the main duplicate signal because it catches renamed copy-paste.
   `dupes` only matches by name. knip (`unused`) is usually clean, so dead code
   tends to be unreachable branches and params never set in data.
3. **Deep read:** run parallel `Explore` subagents per area with
   [the prompts](./references/subagent-prompts.md). Their output is leads, not
   findings.
4. **Classify each lead** after reading the code:
   - _Duplication / same purpose_: real only if the behavior is meant to be
     identical. Not real: deliberate differences, registry conventions (`apply`
     per effect seed), different semantics (default-open vs. default-hidden).
   - _Dead_: no caller. Grep template-string class names and data-driven
     lookups, and check `shared/trees/idler.json` before calling a param
     unused.
   - _Simplifiable_: a one-use wrapper, redundant state, or a hand-rolled copy
     of an existing helper.
   - _Ghost comment_: narrates an earlier design, bug, or refactor ("used to",
     "now that", "extracted from", "replaces the old"), or claims something the
     code contradicts. Keep rationale for why the code avoids an obvious
     alternative, and docs for migration code that still runs (tree codec,
     settings `LEGACY MIGRATION`).
   - _Plan reference_ (`D<n>`, `Phase-N`, `docs/plans/…`): strip the pointer,
     keep the explanation.
   - If a merge makes behavior newly reachable, update the validators too (e.g.
     mode-level `generatorCost` needed the boot-time generator-id check).
5. **Report in the `/review` format:** verdict, then the ranked items (file
   links, problem, fix, size), then **Rejected after checking** and **Out of
   scope**. Wait for approval.
6. **Implement** on `refactor/repo-cleanup-<yyyy-mm>`, one commit per theme,
   bug fixes first. Prefixes: `refactor(scope):` / `fix(scope):` / `docs:` for
   comment-only changes. After editing `shared/`, run
   `pnpm --filter @game/shared build` before testing other packages. After each
   theme, run that package's `pnpm --filter <pkg> test`. Check CSS or UI merges
   in the browser (compare computed styles if the screenshot is ambiguous).
7. **Validate once, at the end:**

   ```bash
   pnpm --filter @game/shared build && pnpm --filter client build && pnpm --filter server build
   pnpm test && pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css \
     && pnpm check:balance && pnpm lint:instructions
   cd e2e && npx playwright test --project=chromium <specs covering the change>
   ```

   (`pnpm build` runs `corepack enable`, which needs root here, so build the
   packages directly.) Then **review `git diff main..HEAD` a second time**; the
   first run found two more bugs this way.

8. **Ship only when told** (`/ship`). **Update the log**: replace the backlog,
   add any new standing rejections, and add one line to the history.
