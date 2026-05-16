# PLAN: Upgrade Type Refactoring

## Status: Final Draft — Ready for Implementation

---

## Problem Statement

The current `UpgradeDefinition` is a single interface with many optional fields
whose validity depends on an unrelated field (`category`). This means:

- A tree upgrade can omit `position` without a compile error.
- A flat upgrade can include `position` and it will silently be ignored.
- `prerequisites` appearing on a flat upgrade has no compile-time warning.
- `goalType` (a visibility filter) lives on the upgrade instead of the goal that
  owns it.
- Both types coexist in one array, making it harder to add upgrades without
  confusion as the game scales.

---

## Design Goals

1. **Compile-time safety** — impossible states are unrepresentable.
2. **Separate arrays** — each structural variant gets its own declaration site.
3. **Extensibility** — new upgrade kinds plug in cleanly without union types.
4. **Goal owns its trophy** — "what triggers a win?" is the goal's concern, not
   the upgrade's.
5. **Explicit intent** — required fields over optional when the default is
   ambiguous.

---

## Proposed Type Hierarchy

```ts
// ─── Typed ID (documentation alias, not branded) ────────────────────

/** Upgrade identifier. Type-alias for documentation — not branded. */
export type UpgradeId = string

// ─── Base (shared mechanical properties) ────────────────────────────

export interface BaseUpgradeDefinition {
  readonly id: UpgradeId
  readonly cost: number
  readonly costCurrency: string // REQUIRED (no implicit fallback)
  readonly modifiers: readonly Modifier[]
  /**
   * How many times this upgrade can be purchased.
   *  0 = unlimited (repeatable indefinitely).
   *  1 = one-shot (most upgrades).
   *  N = exactly N times.
   */
  readonly maxCount: number
}

// ─── Flat Upgrade (list-panel, no spatial data) ─────────────────────

export interface FlatUpgradeDefinition extends BaseUpgradeDefinition {
  // No position, no prerequisites — structurally simple.
}

// ─── Tree Upgrade (tree-panel, spatially placed, prereq graph) ──────

export interface TreeUpgradeDefinition extends BaseUpgradeDefinition {
  readonly position: UpgradePosition // REQUIRED — compile error if missing
  readonly prerequisites: readonly UpgradeId[] // REQUIRED — empty [] = no prereqs
}
```

### Design Decisions

| Decision                         | Rationale                                                           |
| -------------------------------- | ------------------------------------------------------------------- |
| No `AnyUpgradeDefinition` union  | Arrays are always separate; no runtime discrimination needed.       |
| No `kind` discriminant           | Array membership IS the type.                                       |
| `UpgradeId` = unbranded alias    | Self-documenting for `prerequisites`. Can upgrade to branded later. |
| `costCurrency` required          | Eliminates implicit fallback that becomes a bug source at scale.    |
| `prerequisites` required on tree | Empty `[]` = explicit "no deps." Prevents accidental omission.      |
| `maxCount` replaces `repeatable` | Numeric is more expressive: `1`, `-1`, or arbitrary `N`.            |

---

## Trophy Handling: Goal Owns Its Upgrade

### Current problem

The upgrade self-declares `goalType: 'buy-upgrade'`. This is backwards.

### Solution: `BuyUpgradeGoal` references the trophy

```ts
export interface BuyUpgradeGoal {
  readonly type: 'buy-upgrade'
  readonly label: string
  readonly safetyCapSec: number
  readonly trophyUpgradeId: UpgradeId // ← points to the win-trigger upgrade
}
```

The trophy upgrade (`u5` in idler) is a regular `TreeUpgradeDefinition` with no
special marker. The goal knows which upgrade triggers a win.

### Visibility filtering

```ts
function getAvailableUpgrades(
  mode: ModeDefinition,
  activeGoal: Goal,
): { flat: readonly FlatUpgradeDefinition[]; tree: readonly TreeUpgradeDefinition[] } {
  // Trophy IDs from non-active buy-upgrade goals → these upgrades are hidden
  const hiddenTrophyIds = new Set(
    mode.goals
      .filter((g): g is BuyUpgradeGoal => g.type === 'buy-upgrade' && g !== activeGoal)
      .map((g) => g.trophyUpgradeId),
  )

  return {
    flat: mode.flatUpgrades.filter((u) => !hiddenTrophyIds.has(u.id)),
    tree: mode.treeUpgrades.filter((u) => !hiddenTrophyIds.has(u.id)),
  }
}
```

### Win detection (server)

```ts
function checkBuyUpgradeWin(purchasedId: UpgradeId, goal: Goal): boolean {
  return goal.type === 'buy-upgrade' && goal.trophyUpgradeId === purchasedId
}
```

---

## ModeDefinition Changes

```ts
export interface ModeDefinition {
  readonly resources: readonly string[]
  readonly scoreResource: string
  readonly flatUpgrades: readonly FlatUpgradeDefinition[]
  readonly treeUpgrades: readonly TreeUpgradeDefinition[]
  readonly goals: readonly Goal[]
  readonly nativeModifiers: readonly Modifier[]
  readonly clicksEnabled: boolean
  readonly highlightEnabled: boolean
  readonly initialResources: Readonly<Record<string, number>>
  readonly initialMeta: Readonly<Record<string, unknown>>
  readonly generators: readonly GeneratorDefinition[]
  readonly collectDynamic?: (state: Readonly<PlayerState>) => Modifier[]
  readonly flavor: ModeFlavor
}
```

### No `getAllUpgrades` helper

Generic operations (state init, modifier collection, purchase lookup) do NOT
need a combined array:

- **`createInitialState`** — two spreads:
  `...flat.map(u => [u.id, 0]), ...tree.map(u => [u.id, 0])`
- **`collectModifiers`** — two sequential loops (identical logic), or a shared
  inner helper: `collectUpgradeModifiers(upgrades: readonly BaseUpgradeDefinition[], state)`
- **`applyPurchase`** — currently does a linear `.find()`. Refactor to accept a
  precomputed `Map<UpgradeId, FlatUpgradeDefinition | TreeUpgradeDefinition>`
  (the map lives in `match.ts` / `game.ts`; passed as an argument).
- **`isValidPurchase`** — same precomputed map (also passed as argument).

---

## `collectModifiers` — `maxCount` Logic Change

Current logic:

```ts
if (upgrade.repeatable) {
  // scale modifier values by owned count
} else {
  // emit modifiers as-is
}
```

New logic:

```ts
const owned = state.upgrades[upgrade.id] ?? 0
if (owned <= 0) continue

if (upgrade.maxCount === 1) {
  // One-shot: emit modifiers as-is (owned is always 1)
  modifiers.push(...upgrade.modifiers)
} else {
  // Multi-buy (maxCount > 1) or unlimited (maxCount === 0): scale by owned count
  for (const mod of upgrade.modifiers) {
    modifiers.push({ stage: mod.stage, field: mod.field, value: mod.value * owned })
  }
}
```

Note: `maxCount === 1` → only ever have `owned === 1`, so scaling by 1 is
identity. The branch is an optimization (avoids object allocation per modifier),
not a correctness requirement.

---

## `isValidPurchase` — `maxCount` Logic Change

Current:

```ts
if (!def.repeatable && (state.upgrades[upgradeId] ?? 0) > 0) return false
```

New:

```ts
const owned = state.upgrades[upgradeId] ?? 0
if (def.maxCount > 0 && owned >= def.maxCount) return false
```

---

## Network Message (ROUND_START)

```ts
export interface RoundStartMessage {
  type: 'ROUND_START'
  matchId: string
  config: {
    mode: GameMode
    goal: Goal
    flatUpgrades: readonly FlatUpgradeDefinition[]
    treeUpgrades: readonly TreeUpgradeDefinition[]
  }
  opponentName: string
  serverTime: number
}
```

The client stores these as-is in `GameState.flatUpgrades` / `GameState.treeUpgrades`.

---

## Impact Summary

| Area                          | Change                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/types.ts`         | New types. Remove `UpgradeDefinition`, `UpgradeCategory`. Add `UpgradeId`, `BaseUpgradeDefinition`, `FlatUpgradeDefinition`, `TreeUpgradeDefinition`.                                                                                                                                                                                                                                              |
| `shared/src/types.ts` (goals) | `BuyUpgradeGoal` gains `trophyUpgradeId: UpgradeId`.                                                                                                                                                                                                                                                                                                                                               |
| `shared/src/modes/types.ts`   | `upgrades` → `flatUpgrades` + `treeUpgrades`.                                                                                                                                                                                                                                                                                                                                                      |
| `shared/src/modes/clicker.ts` | `flatUpgrades: [...]`, `treeUpgrades: []`. Add `costCurrency: 'r0'`, `maxCount: 1`. Clicker `buy-upgrade` goal gains `trophyUpgradeId: 'u2'`.                                                                                                                                                                                                                                                      |
| `shared/src/modes/idler.ts`   | `flatUpgrades: []`, `treeUpgrades: [...]`. Remove `category`. Add `maxCount`. Make `prerequisites: []` explicit on root nodes. Remove `goalType` from trophy. Idler `buy-upgrade` goal gains `trophyUpgradeId: 'u5'`.                                                                                                                                                                              |
| `shared/src/modes/index.ts`   | `validateModeDefinition`: iterate `[...def.flatUpgrades, ...def.treeUpgrades]` for flavor cross-checks + add trophy-ID validation. `collectModifiers`: shared inner helper or two loops. `createInitialState`: two spreads. `applyPurchase`: lookup map. `getAvailableUpgrades`: returns `{ flat, tree }` with trophy-based filtering.                                                             |
| `shared/src/messages.ts`      | `config.upgrades` → `config.flatUpgrades` + `config.treeUpgrades`.                                                                                                                                                                                                                                                                                                                                 |
| `client/src/game.ts`          | `GameState.upgrades` → `.flatUpgrades` + `.treeUpgrades`. Add precomputed `upgradeMap: Map<UpgradeId, FlatUpgradeDefinition \| TreeUpgradeDefinition>` for O(1) lookup in `doBuy` and reconciliation. `doBuy`: `repeatable` → `maxCount`, remove `costCurrency ??` fallback, `prerequisites ??` → direct access via structural check. `handleStateUpdate` reconciliation loop: same three changes. |
| `client/src/ui/components.ts` | `renderUpgradeTree`: receive `state.treeUpgrades` directly (remove `.filter(u => u.category === 'tree')`), remove `position` null guards, `u.repeatable` → `u.maxCount !== 1`. `renderClickerUpgrades`: iterate `state.flatUpgrades` instead of `state.upgrades`.                                                                                                                                  |
| `client/src/ui/mode-ui.ts`    | `mode.treeUpgrades.length > 0`.                                                                                                                                                                                                                                                                                                                                                                    |
| `client/src/ui/hotkeys.ts`    | Per-index hotkeys bind to `state.flatUpgrades` only. 'C' (buy-cheapest) iterates `[...state.flatUpgrades, ...state.treeUpgrades]` (preserves current buy-any behavior). Remove `UpgradeCategory` import; rewrite category loop.                                                                                                                                                                    |
| `client/src/ui/helpers.ts`    | `isUnlocked`: accept `TreeUpgradeDefinition` (has `.prerequisites`); flat upgrades always unlocked. `canAfford`/`canBuy`: accept `BaseUpgradeDefinition`, remove `mode` param (no fallback). Remove `UpgradeCategory` import; `UPGRADE_HOTKEYS` type becomes plain `Record<string, string>` or inlined.                                                                                            |
| `server/src/bot.ts`           | `ClickerBot` takes `FlatUpgradeDefinition[]`. `IdlerBot` takes `TreeUpgradeDefinition[]` + `Goal` (to read `trophyUpgradeId`). `createBot(mode, modeDef, { flat, tree }, goal)`: new signature adds `goal` param; passes it to `IdlerBot`.                                                                                                                                                         |
| `server/src/validation.ts`    | Map stores `FlatUpgradeDefinition \| TreeUpgradeDefinition`. `maxCount` check replaces `repeatable`. Prerequisites: structural check `'prerequisites' in def`.                                                                                                                                                                                                                                     |
| `server/src/main.ts`          | Calls `getAvailableUpgrades(modeDef, goal)` (×2) — update to destructure `{ flat, tree }`. Calls `createBot(mode, modeDef, availableUpgrades)` (×2) — new call: `createBot(mode, modeDef, { flat, tree }, goal)`.                                                                                                                                                                                  |
| `server/src/match.ts`         | `upgradeMap: Map<UpgradeId, FlatUpgradeDefinition \| TreeUpgradeDefinition>` (built from both arrays). Calls `getAvailableUpgrades` → `{ flat, tree }`. Passes to bot factory. ROUND_START sends two fields. Trophy win: `goal.trophyUpgradeId === id`.                                                                                                                                            |
| `scripts/simulate-idler.ts`   | `idlerDef.upgrades` → `idlerDef.treeUpgrades`. Remove `costCurrency ??` fallback. **Pre-existing issue**: script uses slug IDs (`'sharpened-axes'`) but actual IDs are `u0`–`u5`. Fix IDs as part of this refactor.                                                                                                                                                                                |
| `docs/DESIGN.md`              | Update file-tree description (replace `UpgradeDefinition` references).                                                                                                                                                                                                                                                                                                                             |
| Tests (shared)                | `modes.test.ts`: rewrite `getAvailableUpgrades` tests with `{ flat, tree }` return. Replace "tagged upgrade" assertion with trophy-ID-on-goal assertion. `collectModifiers` scaling test: `repeatable` → `maxCount: 0`.                                                                                                                                                                            |
| Tests (server)                | `validation.test.ts`: update map builders. `bot.test.ts`: remove `goalType` from fixtures, pass goal to `IdlerBot`. All synthetic upgrade fixtures gain required fields (`costCurrency`, `maxCount`).                                                                                                                                                                                              |
| Tests (client)                | `helpers.test.ts`: split `makeUpgrade` into `makeFlatUpgrade`/`makeTreeUpgrade`. `GameState` fixture: `flatUpgrades: [], treeUpgrades: []`. `game.test.ts` / `components.test.ts`: update arrays. All synthetic upgrade fixtures gain required fields (`costCurrency`, `maxCount`).                                                                                                                |

**Estimated scope**: ~24 files, ~350 lines changed. No logic changes — purely
structural typing refactor + trophy inversion.

---

## Resolved Decisions

| #   | Question                         | Answer                                                     |
| --- | -------------------------------- | ---------------------------------------------------------- |
| 1   | Branded vs unbranded `UpgradeId` | **Unbranded** `type UpgradeId = string` for now.           |
| 2   | `getAllUpgrades` helper          | **Not needed.** Two loops / two spreads / precomputed map. |
| 3   | Network message format           | **Two fields** (`flatUpgrades` + `treeUpgrades`).          |
| 4   | Prerequisites on flat upgrades   | **No.** If flat needs prereqs, it becomes a tree.          |

---

## Review Findings (Pitfalls & Edge Cases)

### 1. `isValidPurchase` needs prerequisite handling for both types

The precomputed `upgradeMap` will hold `BaseUpgradeDefinition` values. But
`BaseUpgradeDefinition` doesn't have `.prerequisites` — only
`TreeUpgradeDefinition` does.

**Fix**: In `isValidPurchase`, check prerequisites only when the value has a
`prerequisites` property. Use a structural check:

```ts
if ('prerequisites' in def) {
  for (const pid of def.prerequisites) {
    if ((state.upgrades[pid] ?? 0) <= 0) return false
  }
}
```

Alternatively, make the map `Map<UpgradeId, FlatUpgradeDefinition | TreeUpgradeDefinition>`
and use the same structural check. This avoids losing the prerequisite info
when inserting tree upgrades into the map.

**Decision**: The map stores `FlatUpgradeDefinition | TreeUpgradeDefinition`
(not narrowed to `BaseUpgradeDefinition`). The union preserves all fields.

### 2. `collectModifiers` scaling logic for `maxCount > 1` (but finite)

With `maxCount: 3`, an upgrade can be owned 1, 2, or 3 times. The modifier
scaling (`value * owned`) is correct for all counts regardless of `maxCount`.
The `maxCount` field is only a cap on _purchases_, not on modifier behavior.
(`maxCount: 0` means no cap.)

No issue here — just confirming the logic is consistent.

### 3. Bot trophy detection changes

The `IdlerBot` currently finds the trophy via:

```ts
upgrades.find((u) => u.goalType === 'buy-upgrade')
```

After the refactor, the bot receives the goal object and reads
`goal.trophyUpgradeId` directly — simpler and more reliable. The
`resolvePath` function already works with `TreeUpgradeDefinition` (it
uses `.prerequisites`), so it naturally benefits from the required field.

### 4. Client `canBuy` helper uses `costCurrency ?? mode.scoreResource`

This fallback disappears because `costCurrency` is now required. The helper
simplifies to `state.resources[def.costCurrency] >= def.cost`.

Update: `canAfford` in `client/src/ui/helpers.ts` currently takes `mode` as a
parameter for this fallback. After refactor, `mode` param can be removed from
that function (or kept for future use).

### 5. `state.upgrades` record key type

`PlayerState.upgrades` is `Record<string, number>`. With `UpgradeId = string`
(unbranded), there's no practical change. If we ever brand `UpgradeId`, the
record key type needs updating to `Record<UpgradeId, number>`.

No action needed now.

### 6. Network serialization — `BaseUpgradeDefinition` is a plain object

Both `FlatUpgradeDefinition` and `TreeUpgradeDefinition` are plain readonly
interfaces with no methods. They serialize to JSON (via `JSON.stringify` in
WebSocket `send`) without issue. The structural difference (presence/absence of
`position` and `prerequisites`) survives round-trip — the client can check
`'position' in u` if it ever needs to distinguish after deserialisation.

No issue.

### 7. `clicker` mode: what about the trophy upgrade `u2` (The Coronation)?

Currently `u2` has `goalType: 'buy-upgrade'` and no `category`/`position`/
`prerequisites`. After refactor:

- `u2` is a `FlatUpgradeDefinition` (no position, no prereqs).
- The clicker `buy-upgrade` goal gains `trophyUpgradeId: 'u2'`.
- `u2` remains in `flatUpgrades` — it's just a regular upgrade that the goal
  points to.

This works cleanly. The trophy can be a flat OR tree upgrade — the goal doesn't
care what array it came from.

### 8. Validation startup: trophy ID must reference an existing upgrade

`validateModeDefinition` should verify that every `BuyUpgradeGoal`'s
`trophyUpgradeId` actually exists in either `flatUpgrades` or `treeUpgrades`.
Otherwise a typo in the goal silently creates an unwinnable game.

**Add to validation**:

```ts
for (const goal of def.goals) {
  if (goal.type === 'buy-upgrade') {
    const allIds = [...def.flatUpgrades, ...def.treeUpgrades].map((u) => u.id)
    if (!allIds.includes(goal.trophyUpgradeId)) {
      throw new Error(
        `[${id}] buy-upgrade goal references unknown trophy '${goal.trophyUpgradeId}'`,
      )
    }
  }
}
```

### 9. `FlatUpgradeDefinition` is structurally identical to `BaseUpgradeDefinition`

Since `FlatUpgradeDefinition extends BaseUpgradeDefinition` with no additional
fields, TypeScript will see them as structurally identical. This means a
`TreeUpgradeDefinition` is assignable to `FlatUpgradeDefinition` (it has all
the base fields). This is normally fine because we never mix them — array
membership prevents confusion. But it means the compiler won't catch:

```ts
const flat: FlatUpgradeDefinition[] = [someTreeUpgrade] // compiles!
```

This is acceptable because:

- In practice, literals are written directly in arrays, not assigned cross-type.
- If this becomes a problem, we can add a branded `readonly _flat?: never` field
  later. Not worth the noise now.

---

## Migration Strategy

1. Define new types in `shared/src/types.ts` alongside old `UpgradeDefinition`.
2. Add `flatUpgrades` + `treeUpgrades` to `ModeDefinition` alongside old `upgrades`.
3. Migrate `shared/src/modes/index.ts` + `server/src/match.ts` + `server/src/main.ts`
   - affected test call sites atomically (changing `getAvailableUpgrades` return
     type breaks all call sites).
4. Migrate remaining server (`bot.ts`, `validation.ts`).
5. Migrate client (`game.ts`, `ui/*.ts`).
6. Migrate `scripts/simulate-idler.ts` (fix slug IDs → `u0`–`u5`).
7. Migrate remaining tests.
8. Remove old `upgrades` field, `UpgradeDefinition`, `UpgradeCategory`.
9. Full test suite + typecheck at each step.

**Note**: Step 3 must be atomic because `getAvailableUpgrades` changes its return
type from `readonly UpgradeDefinition[]` to `{ flat, tree }`, which immediately
breaks all call sites (`match.ts`, `main.ts`, and tests that call it directly).
The `null` param support is also dropped (production never passes `null`).

**Estimated scope**: ~24 files, ~350 lines changed.
