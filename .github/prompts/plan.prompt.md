---
description: 'Use when starting any feature or non-trivial change — write a full plan (files, types, tests, open questions) in docs/plans before writing production code.'
name: 'Plan'
argument-hint: 'What to plan (feature, refactor, or change)'
agent: 'agent'
---

# Plan a feature or non-trivial change

Produce a written plan. Do **not** write production code yet — tests, types, and
pseudocode inside the plan are fine.

1. **Where to write it.** New feature → a numbered file in `docs/plans/` (match the
   existing `NN-name.md` convention, incrementing `NN`). Small change to an existing
   system → a section in the relevant doc (`docs/DESIGN.md`, etc.). Pick whichever
   fits; don't create a doc if a section will do.
2. **What to cover.** The problem, the approach, the files/modules touched, data or
   type changes, test strategy, and any open questions. Keep it proportional to the
   change — not every task needs a long doc.
3. **Complexity check.** Flag any new abstraction, field, or coupling and justify it.
   Prefer deleting over adding. Call out speculative "in case we need it" work.
4. **Present and wait.** Show the plan and stop. Do not implement until I approve
   ("go", "implement", "looks good"). Iterate if I ask.

After approval, implement per the workflow in `copilot-instructions.md`: commit
locally, self-review with `git diff HEAD~1`, run the affected tests, and wait for my
review before shipping.
