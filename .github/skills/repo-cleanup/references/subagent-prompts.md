# Subagent prompts for the cleanup pass

Dispatch these in parallel (`Explore` agent, READ-ONLY), one per area:
`shared/src` · `server/src` + `scripts` + `client/src/*.ts` + `client/src/stats`
· `client/src/ui` + `client/src/style.css` · `client/src/dev` + `dev.css`.
Substitute `<AREA>`. Their output is a set of **leads**: verify every one.

## A. Structure (duplication, dead code, simplification)

```text
Thorough, READ-ONLY code review of <AREA> in /home/yonisimian/documents/incremental-game.
Do NOT edit files. Report with exact file paths + line numbers:
1. Code duplication: copy-pasted functions, near-identical DOM builders, repeated
   CSS rule blocks, repeated walks/loops. Note where copies have DRIFTED (one has a
   fix or guard the other lacks); those are the most valuable finds.
2. Different code with the same purpose that should be merged (two helpers or
   classes or CSS blocks doing one job under different names), including code that
   re-implements something already in @game/shared.
3. Dead code: functions, branches, params or CSS classes never used. Before
   flagging a CSS class, check for template-string/dynamic class construction.
   Before flagging a param as unused, check shared/trees/idler.json.
4. Code that could be noticeably simplified (one-use helpers, redundant state).
Skip nitpicks (naming, formatting). For each: location(s), what's wrong, concrete
fix, rough size. Max ~15 items, prioritized. Also list anything you checked and
decided was intentional, with the reason.
```

## B. Comments (ghost / history / plan refs)

```text
READ-ONLY audit of every code comment in <AREA> of
/home/yonisimian/documents/incremental-game. Read every file; don't rely on grep.
Find comments that describe something NOT in the current code:
- GHOST: an earlier design, draft, or bug that isn't in the code ("previously X,
  so now Y", "unlike the old version", "the fix is…"), or a claim the code
  contradicts (e.g. "supports legacy arrays" when the type has no array form).
- HISTORY: narrates a real past refactor ("moved from X", "replaces the old Y",
  "now that X", "extracted verbatim from").
- PLANREF: cites plan docs or decision IDs (D1, D17, Phase-2, master-plan, docs/plans).
KEEP (don't report): rationale for not taking an obvious alternative ("rather
than X, because Y"), invariants, and docs for migration code that still runs
(verify it runs).
For each: path, line range, verbatim text, class, one-line reason, proposed
replacement (or "delete"). Only report what you're confident about; mark doubtful
items BORDERLINE.
```
