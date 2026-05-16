# Auto-Generators Feature — Implementation Plan

## Overview

Cookie Clicker–style buildings that passively generate resources.
Three tiers for **clicker mode only** (idler mode unchanged for now).
Each tier costs more but produces more.
Generators are **repeatable** purchases — buy multiple copies; rate scales linearly with count.

---

## 1. Data Model

### 1.1 New type: `GeneratorDefinition` (shared/src/types.ts)

```ts
export interface GeneratorDefinition {
  readonly id: string
  readonly name: string
  readonly icon: string // emoji
  readonly baseCost: number
  readonly costScaling: number // 1.15
  readonly costCurrency: string // which resource pays
  readonly production: {
    readonly resource: string // which resource is produced
    readonly rate: number // per second, per copy owned
  }
}
```

Cost formula: `Math.floor(baseCost × costScaling ^ owned)`

### 1.2 New field on `PlayerState` (shared/src/types.ts)

```ts
export interface PlayerState {
  score: number
  resources: Record<string, number>
  upgrades: Record<string, number>
  generators: Record<string, number> // ← NEW
  meta: Record<string, unknown>
}
```

### 1.3 New field on `ModeDefinition` (shared/src/modes/types.ts)

```ts
export interface ModeDefinition {
  // ... existing fields ...
  readonly generators: readonly GeneratorDefinition[] // ← NEW
}
```

---

## 2. Generator Definitions (Clicker Mode Only)

Defined in `shared/src/modes/clicker.ts`. Idler mode gets `generators: []`.

| ID        | Name    | Icon | Base Cost | Cost Currency | Production      |
| --------- | ------- | ---- | --------- | ------------- | --------------- |
| `cursor`  | Cursor  | 🖱️   | 15        | currency      | +0.5 currency/s |
| `intern`  | Intern  | 👨‍💼   | 100       | currency      | +3 currency/s   |
| `factory` | Factory | 🏭   | 500       | currency      | +15 currency/s  |

All use `costScaling: 1.15`.

---

## 3. Shared Logic Changes

### 3.1 Generator cost helper (new: shared/src/generators.ts)

```ts
export function getGeneratorCost(def: GeneratorDefinition, owned: number): number {
  return Math.floor(def.baseCost * def.costScaling ** owned)
}

export function canAffordGenerator(
  state: Readonly<PlayerState>,
  def: GeneratorDefinition,
): boolean {
  const cost = getGeneratorCost(def, state.generators[def.id] ?? 0)
  return (state.resources[def.costCurrency] ?? 0) >= cost
}

export function applyGeneratorPurchase(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): void {
  const def = mode.generators.find((g) => g.id === generatorId)
  if (!def) return
  const owned = state.generators[def.id] ?? 0
  const cost = getGeneratorCost(def, owned)
  state.resources[def.costCurrency] -= cost
  state.generators[def.id] = owned + 1
}
```

Export from shared/src/index.ts.

### 3.2 Modifier collection (shared/src/modes/index.ts)

In `collectModifiers()`, add a loop after upgrade modifiers:

```ts
// Generator modifiers
for (const gen of mode.generators) {
  const owned = state.generators[gen.id] ?? 0
  if (owned <= 0) continue
  modifiers.push({
    stage: 'additive',
    field: gen.production.resource,
    value: gen.production.rate * owned,
  })
}
```

Generators contribute **additive** modifiers — they get multiplied by any
existing multiplicative upgrades (e.g., Multiplier ×2) automatically.

### 3.3 Initial state (shared/src/modes/index.ts)

In `createInitialState()`, add:

```ts
generators: Object.fromEntries(mode.generators.map((g) => [g.id, 0])),
```

---

## 4. Action & Network Changes

### 4.1 New action type (shared/src/types.ts)

```ts
export type ActionType = 'click' | 'buy' | 'buy_generator' | 'set_highlight'
```

Extend `PlayerAction`:

```ts
export interface PlayerAction {
  type: ActionType
  timestamp: number
  upgradeId?: string
  generatorId?: string // ← NEW: for 'buy_generator' actions
  highlight?: string
}
```

### 4.2 No message format changes

`ActionBatchMessage` already carries `PlayerAction[]` — adding a new
action type + field is backward-compatible.

---

## 5. Server Changes (server/src/match.ts)

### 5.1 Validation (server/src/validation.ts)

New function:

```ts
export function isValidGeneratorPurchase(
  state: PlayerState,
  generatorId: string,
  generatorMap: ReadonlyMap<string, GeneratorDefinition>,
): boolean {
  const def = generatorMap.get(generatorId)
  if (!def) return false
  return canAffordGenerator(state, def)
}
```

### 5.2 Match constructor — build `generatorMap` (server/src/match.ts)

Mirror the existing `upgradeMap` pattern for O(1) lookups:

```ts
private readonly generatorMap: ReadonlyMap<string, GeneratorDefinition>
// in constructor:
this.generatorMap = new Map(this.modeDef.generators.map((g) => [g.id, g]))
```

### 5.3 Action processing (server/src/match.ts — `processActions`)

Add a new branch:

```ts
} else if (action.type === 'buy_generator' && action.generatorId) {
  if (!isValidGeneratorPurchase(player.state, action.generatorId, this.generatorMap)) continue
  applyGeneratorPurchase(player.state, action.generatorId, this.modeDef)
}
```

### 5.4 No tick changes

Generators produce income via `collectModifiers()` → `computePassiveRates()`
→ `applyPassiveTick()`. The tick loop already calls this pipeline every 250ms.
No modifications needed.

### 5.5 Broadcast — no changes needed

`broadcastState()` sends the full `PlayerState` object (which now includes
`generators`) — no serialization changes required.

---

## 6. Client Changes

### 6.1 Game actions (client/src/game.ts)

New `doBuyGenerator()` function (mirrors `doBuy()`):

```ts
export function doBuyGenerator(generatorId: string): void {
  if (state.screen !== 'playing' || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  const def = modeDef.generators.find((g) => g.id === generatorId)
  if (!def) return
  if (!canAffordGenerator(state.player, def)) return
  applyGeneratorPurchase(state.player, generatorId, modeDef)
  queueAction({ type: 'buy_generator', timestamp: Date.now(), generatorId })
  trackPendingGeneratorPurchase(generatorId)
  notify()
}
```

### 6.2 EMPTY_PLAYER_STATE + clonePlayerState (client/src/game.ts)

Both must include `generators`:

```ts
const EMPTY_PLAYER_STATE: PlayerState = {
  score: 0,
  resources: {},
  upgrades: {},
  generators: {}, // ← NEW
  meta: {},
}

function clonePlayerState(s: Readonly<PlayerState>): PlayerState {
  return {
    score: s.score,
    resources: { ...s.resources },
    upgrades: { ...s.upgrades },
    generators: { ...s.generators }, // ← NEW
    meta: structuredClone(s.meta),
  }
}
```

### 6.3 Optimistic reconciliation (client/src/game.ts)

Generator purchases must survive server state updates. Changes:

1. Add `generatorPurchases: string[]` to `PendingBatch`:

```ts
interface PendingBatch {
  seq: number
  clicks: number
  purchases: string[]
  generatorPurchases: string[] // ← NEW
  highlight?: string
}
```

2. Update `getOrCreateBatch()` to include: `generatorPurchases: []`

3. New tracker:

```ts
function trackPendingGeneratorPurchase(generatorId: string): void {
  getOrCreateBatch().generatorPurchases.push(generatorId)
}
```

4. In `handleStateUpdate()` reconciliation loop, after the upgrade replay block, add:

```ts
for (const gid of batch.generatorPurchases) {
  if (!modeDef) continue
  const def = modeDef.generators.find((g) => g.id === gid)
  if (!def) continue
  if (!canAffordGenerator(reconciled, def)) continue
  applyGeneratorPurchase(reconciled, gid, modeDef)
}
```

### 6.4 Generator definitions source

Generator definitions are read from `getModeDefinition()` (a shared import),
**not** from a server-provided field on `RoundStartMessage`. This differs from
upgrades which are sent in the ROUND_START config message. Rationale: generators
are always the same per mode and don't vary per round. This avoids touching the
message protocol. If per-round generator customization is needed later, add a
`generators` field to `RoundStartMessage.config` at that time.

---

## 7. UI — Generators Panel (slot 1)

### 7.1 New file: client/src/ui/panels/generators-panel.ts

```ts
export const generatorsPanel: Panel = {
  label: 'Generators',
  icon: '🏭',
  render(container, state) { ... },
  bind(state) { ... },
  update(state) { ... },
}
```

**render()**: For each generator in the mode definition, render a card:

- Icon + name
- "Owned: N"
- "Produces: +X resource/s" (rate × owned, formatted)
- "Cost: Y resource" (next cost, formatted)
- Buy button (disabled if can't afford)

**bind()**: Event delegation on the generator list container (same
pattern as `bindUpgradeEvents()` — single delegated click handler).

**update()**: Dirty-check the rendered HTML (same `prevHtml` pattern
as play-panel upgrades) to avoid DOM churn every tick.

### 7.2 Register in init.ts (conditionally)

The generators panel should only be registered when the mode has generators.
Since `initPanels()` runs at startup (before mode is known), registration
happens at match start instead:

- In `renderPlayingScreen()` (or a new `initMatchPanels(mode)` helper),
  check `getModeDefinition(mode).generators.length > 0` and conditionally
  call `registerPanel(1, generatorsPanel)` + unregister on match end.
- **Simpler alternative**: Always register at slot 1. If the mode has no
  generators, `render()` shows an empty/locked state. This avoids
  dynamic registration complexity.

**Decision**: Always register at slot 1. The panel's `render()` will check
`generators.length` and show a placeholder if empty ("No generators in this
mode"). This keeps init.ts simple:

```ts
import { generatorsPanel } from './generators-panel.js'

export function initPanels(): void {
  registerPanel(0, playPanel)
  registerPanel(1, generatorsPanel)
}
```

The panel handles the empty-mode case internally.

### 7.3 CSS (client/src/style.css)

New classes under `/* Generators Panel */`:

- `.generator-list` — flex column, gap
- `.generator-card` — styled like `.upgrade-btn` but wider, with count badge
- `.generator-card:disabled` — dimmed
- `.generator-rate` — small text showing production rate
- `.generator-cost` — cost label, gold-colored
- `.generator-count` — badge showing owned count

---

## 8. File Change Summary

| File                                       | Change                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/src/types.ts`                      | Add `GeneratorDefinition`, `generators` to `PlayerState`, `buy_generator` to `ActionType`, `generatorId` to `PlayerAction`                 |
| `shared/src/modes/types.ts`                | Add `generators` to `ModeDefinition`                                                                                                       |
| `shared/src/generators.ts`                 | **NEW** — `getGeneratorCost`, `canAffordGenerator`, `applyGeneratorPurchase`                                                               |
| `shared/src/modes/clicker.ts`              | Add `generators` array (3 defs)                                                                                                            |
| `shared/src/modes/idler.ts`                | Add `generators: []` (empty — no generators for idler)                                                                                     |
| `shared/src/modes/index.ts`                | Update `createInitialState` + `collectModifiers` for generators                                                                            |
| `shared/src/index.ts`                      | Re-export from `generators.ts`                                                                                                             |
| `server/src/validation.ts`                 | Add `isValidGeneratorPurchase`                                                                                                             |
| `server/src/match.ts`                      | Handle `buy_generator` action in `processActions`, build `generatorMap`                                                                    |
| `client/src/game.ts`                       | Add `doBuyGenerator()`, `generators` in `EMPTY_PLAYER_STATE` + `clonePlayerState`, `generatorPurchases` in `PendingBatch` + reconciliation |
| `client/src/ui/panels/generators-panel.ts` | **NEW** — generators panel                                                                                                                 |
| `client/src/ui/panels/init.ts`             | Register generators panel at slot 1                                                                                                        |
| `client/src/style.css`                     | Generator card styles                                                                                                                      |

---

## 9. Implementation Order

1. **Shared types** — `GeneratorDefinition`, `PlayerState.generators`, action type, `generatorId` on `PlayerAction`
2. **Shared logic** — `generators.ts` (cost, afford, purchase)
3. **Mode definitions** — `generators` array in clicker.ts (3 defs), `generators: []` in idler.ts, `generators` in `ModeDefinition`
4. **Shared integration** — `createInitialState` + `collectModifiers` for generators
5. **Shared barrel** — re-export from `index.ts`
6. **Server** — `generatorMap` in Match constructor, validation, action handler in `processActions`
7. **Client game logic** — `EMPTY_PLAYER_STATE.generators`, `clonePlayerState`, `PendingBatch.generatorPurchases`, reconciliation replay, `doBuyGenerator()`
8. **Client UI** — generators-panel.ts + CSS + registration in init.ts
9. **Typecheck + lint + test**
10. **Commit**: `feat(generators): add auto-generator buildings (clicker mode)`

---

## 10. Out of Scope (documented)

- **Sell mechanic** — Can add later.
- **Generator-specific upgrades** — e.g., "Double cursor output". Can add later.
- **Visual production indicators** — e.g., floating "+0.5/s" per tick. Nice-to-have.
- **Balance tuning** — Costs and rates above are initial values; will need playtesting.
- **Idler generators** — The infrastructure supports any mode having generators
  (via `ModeDefinition.generators`), but idler mode ships with `generators: []`.
  Can add idler-specific generators in a follow-up.
- **Bot generator purchases** — The bot strategy (`server/src/bot.ts`) currently
  only buys upgrades. Teaching it to buy generators requires strategy tuning
  (when to invest in generators vs. upgrades). Out of scope for this commit;
  tracked for a follow-up.
- **End-of-round stats for generators** — `player.stats` currently tracks
  `upgradesPurchased`. Generator purchases are not tracked in stats.
  Can be added in a follow-up.
- **Per-round generator customization** — Generator definitions are read from
  `getModeDefinition()`, not from `RoundStartMessage`. If custom per-round
  generators are needed later, extend the message protocol then.
