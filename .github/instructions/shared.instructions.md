---
description: 'Conventions for shared/src (game logic, effects, modifier pipeline, flavor, mode/tree data). Use when adding or editing effects, modifiers, modes, or the idler tree.'
name: 'shared package conventions'
applyTo: 'shared/src/**,shared/trees/**'
---

# `shared/` conventions

Full detail lives in the **Architecture** and **Extending the game** sections of
[CLAUDE.md](../../CLAUDE.md) (the authoritative source). Reinforce at edit time:

- **Rebuild after editing.** server/client import `shared/dist/`, not source — run
  `pnpm --filter @game/shared build` (or keep `pnpm dev:shared` running) or you'll test
  stale code. Imports use explicit `.js` extensions even in `.ts` files.
- **Extend by registering, not editing.** New effects go in `shared/src/effects/seed/`
  (a **pure** `apply` + a zod `schema`) registered by name; new production systems are a
  stage in the modifier pipeline. Keep `apply` pure; don't rebuild lookup tables per tick.
- **Don't conflate score and resources.** Score never decreases; resources are spendable.
  Abstract IDs only (`r0/r1`, `u0…`, `g0…`) — display lives in `ModeFlavor`.
