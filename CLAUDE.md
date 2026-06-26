# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A real-time, head-to-head competitive incremental game. Two players race to accumulate score within a time-limited round. pnpm monorepo: `shared/` (game logic + types), `server/` (authoritative WebSocket game server), `client/` (vanilla-TS browser UI).

## Commands

```bash
pnpm dev                 # build shared, then run shared(watch) + server + client concurrently
pnpm dev:server          # server only (tsx watch, port 10000)
pnpm dev:client          # client only (vite, http://localhost:5173)
pnpm build               # full production build (shared → client → server)

pnpm test                # all packages
pnpm --filter @game/shared test          # one package
pnpm --filter @game/shared exec vitest run tests/pipeline.test.ts   # single test file
pnpm --filter @game/shared exec vitest -t "name"                    # single test by name

pnpm typecheck           # builds shared, then tsc --noEmit across all three packages
pnpm lint                # eslint (also: lint:fix, lint:md, lint:css, lint:exports)
pnpm format              # prettier write (format:check for CI)
```

`pre-push` hook runs `typecheck && format:check && lint && lint:css` — run these before pushing or the push fails. Commits use [conventional commits](https://www.conventionalcommits.org/) and land directly on `main`.

## The shared-build dependency (most common gotcha)

`@game/shared` compiles to `shared/dist/`, and `server`/`client` import the **compiled output**, not the source. `pnpm dev`, `build`, and `typecheck` all build shared first. If you edit a file under `shared/src/` and then run server or client tests/typecheck directly, you'll be testing stale code — rebuild with `pnpm --filter @game/shared build` (or keep `pnpm dev:shared` running in watch mode). The dev server (`tsx watch`) is configured to also restart on changes to `shared/dist/**` and `shared/trees/**`.

All TS source uses ESM with explicit `.js` extensions in import paths (e.g. `import { x } from './types.js'`) even though the files are `.ts`. Match this.

## Architecture

### Networking: client-predicted, server-authoritative

The server owns all game state, the round timer, and the win decision. Clients track state **optimistically** for instant click/purchase feedback, batch timestamped actions to the server (~500ms), and reconcile on each `STATE_UPDATE`. Reconciliation uses `ackSeq`: the client re-applies any local actions with `seq > ackSeq` on top of the server snapshot, so optimistic clicks don't flicker. Wire message types live in [shared/src/messages.ts](shared/src/messages.ts). Server flow: [server/src/main.ts](server/src/main.ts) (HTTP health + WS), [matchmaking.ts](server/src/matchmaking.ts) (queue + rooms + TTL), [match.ts](server/src/match.ts) (countdown/tick/scoring), [validation.ts](server/src/validation.ts) (anti-cheat), [bot.ts](server/src/bot.ts).

**Score vs resources:** resources are spendable currencies that go down when you buy; _score_ is total `scoreResource` ever earned and never decreases — so buying upgrades never lowers your score. Highest score at round end wins; equal scores = draw.

### Flavor abstraction (mechanics ↔ display decoupling)

All mechanics use abstract IDs — resources `r0/r1`, upgrades `u0…`, generators `g0…`. The server never sees "Wood" or "🪵". Display data (names, icons, descriptions, theme) lives in a separate `ModeFlavor` attached to each `ModeDefinition`. Adding a mode = defining mechanics + a flavor; the client UI derives panels/hotkeys/cards automatically. `validateModeDefinition` runs at startup and **throws if flavor and mechanics disagree** (mismatched keys, missing/orphan entries) — the app won't start with an incomplete flavor. Cached lookups via WeakMap in [shared/src/flavor.ts](shared/src/flavor.ts); don't rebuild lookup tables per tick.

### Modifier pipeline + effects registry (how bonuses compose)

Every system that affects income funnels through one pipeline ([shared/src/modifiers/pipeline.ts](shared/src/modifiers/pipeline.ts)): base → native → tiers (additive) → upgrades/cards → perks/prestige (multiplicative). Adding a system means registering a modifier stage, not editing existing code.

Upgrade behavior is **data-driven via effects**. Effect implementations are registered by name in [shared/src/effects/registry.ts](shared/src/effects/registry.ts); the seed set (`highlightMultiplier`, `lowerTierBoost`, `generatorCost`, `panelUnlock`, etc.) lives in `shared/src/effects/seed/` and is registered at module load by importing the effects barrel. Mode/upgrade data references effects by `{type, params}` refs, validated and cached per-ref-identity at startup.

### The idler mode is authored as JSON

[shared/trees/idler.json](shared/trees/idler.json) is the single source of truth for the idler mode's upgrade tree, generators, and effect wiring. It's loaded at runtime, decoded by `shared/src/tree/codec.ts` against `schema.ts`, and flattened from a nested authoring tree (`offset`-relative layout) into the flat `UpgradeDefinition[]` the engine consumes (`flattenUpgradeTree` in [shared/src/modes/upgrade-tree.ts](shared/src/modes/upgrade-tree.ts)). **Layout children ≠ prerequisites** — gating lives entirely in each node's `prerequisites`. There is a visual tree editor under `client/src/dev/editor/` (served at `/dev.html`).

### Client UI structure

Vanilla DOM, no framework. [client/src/game.ts](client/src/game.ts) = local state + prediction; [network.ts](client/src/network.ts) = WS/batching/reconciliation. UI is a screen router ([ui/index.ts](client/src/ui/index.ts)) over panels ([ui/panels.ts](client/src/ui/panels.ts) + `ui/panels/*`) whose layout is derived from the `ModeDefinition` via [ui/mode-ui.ts](client/src/ui/mode-ui.ts). VFX in `ui/vfx/`. A balance dev panel (`/dev.html`, `client/src/dev/`) runs strategy simulations and charts — useful for tuning. Vite enforces a bundle-size budget (warn 60 kB / fail 80 kB raw) via a custom plugin.

## Extending the game

**Add an effect:** create a file in `shared/src/effects/seed/` exporting an `EffectDef` — a zod `schema` (the param shape) plus a **pure** `apply(params, state, mode)` — then register it by name in [shared/src/effects/index.ts](shared/src/effects/index.ts) (registration happens once at module load; a duplicate name throws). `apply` returns `EffectOutput`(s) or `null`; the `kind` discriminant routes each output to a different subsystem — a `Modifier` to the production pipeline (`collectModifiers`), a `generatorCost` to `collectGeneratorCostFactors`, a `panelUnlock` to `isPanelUnlocked` — and every consumer ignores outputs it doesn't own. The zod schema is the single source of truth: it both validates raw refs at the trust boundary _and_ is introspected by the `/dev.html` editor to auto-generate the param form, so an effect with no schema has no editor form.

**Add a panel:** implement the `Panel` interface (`render` + optional `update`/`bind`) in `client/src/ui/panels/`, then place it in the 10-slot (5×2) tab grid via `configurePanels` (driven per-mode by [ui/mode-ui.ts](client/src/ui/mode-ui.ts)). To gate a tab behind an upgrade, the panel's stable `id` must match the `panel` field of a `panelUnlock` effect — keep those two strings in sync, or the tab never unlocks (or unlocks unconditionally). Unlocks are monotonic (locked→unlocked, never back).

**Edit the idler tree:** prefer the visual editor at `/dev.html` over hand-editing [shared/trees/idler.json](shared/trees/idler.json) — it introspects effect schemas and writes valid JSON. After either, `validateModeDefinition` runs at startup and will refuse to boot on malformed data.

## Reference docs

- [docs/DESIGN.md](docs/DESIGN.md) — full architecture, game flow, deployment (Render), and the systems roadmap.
- [docs/BALANCE.md](docs/BALANCE.md) — balancing framework and formulas.

## Notes

- `COUNTDOWN_SEC` in [shared/src/game-config.ts](shared/src/game-config.ts) is temporarily `0` for dev; restore to `3` before publishing.
- ESLint enforces `eqeqeq`, `prefer-template`, `no-floating-promises`, and `no-console` (warn; `warn`/`error`/`info` allowed) in non-test code. Test and script files relax these.
