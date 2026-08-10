---
description: 'Conventions for shared/src (game logic, effects, modifier pipeline, flavor, mode/tree data). Use when adding or editing effects, modifiers, modes, or the idler tree.'
name: 'shared package conventions'
applyTo: 'shared/src/**,shared/trees/**'
---

# `shared/` conventions

`@game/shared` is pure, deterministic game logic consumed by both server and client.
Depth lives in [CLAUDE.md](../../CLAUDE.md); these are the rules that bite.

## Build & imports

- **Compiled-output dependency:** server/client import `shared/dist/`, not source. After
  editing `shared/src/**`, rebuild (`pnpm --filter @game/shared build`) or keep
  `pnpm dev:shared` running, or you'll test stale code.
- **ESM with explicit `.js` extensions** in every import path, even from `.ts`
  (`import { x } from './types.js'`). Match this exactly.

## Extend by registering, not editing

- **Add an effect:** new file in `shared/src/effects/seed/` exporting an `EffectDef`
  (a zod `schema` + a **pure** `apply(params, state, mode)` returning `EffectOutput`(s)
  or `null`), then register it by name in `shared/src/effects/index.ts`. Duplicate
  names throw. The zod schema is the single source of truth — it validates raw refs
  and drives the `/dev.html` editor form, so no schema = no editor form.
- **Add a production system:** register a stage in the modifier pipeline
  (`shared/src/modifiers/pipeline.ts`); don't thread special cases through existing code.
- Keep `apply` pure and side-effect-free. Don't rebuild lookup tables per tick — reuse
  the cached WeakMap lookups in `shared/src/flavor.ts`.

## Flavor ↔ mechanics

- Mechanics use abstract IDs only (`r0/r1`, `u0…`, `g0…`). Names/icons/theme live in
  the mode's `ModeFlavor`. `validateModeDefinition` throws at startup if flavor and
  mechanics disagree — keep keys in sync.
- Prefer the visual editor at `/dev.html` over hand-editing
  [shared/trees/idler.json](../../shared/trees/idler.json).

## Correctness

- Score never decreases (total `scoreResource` earned); resources are spendable. Don't
  conflate them.
- Lint (non-test): `eqeqeq`, `prefer-template`, `no-floating-promises`, `no-console`.
