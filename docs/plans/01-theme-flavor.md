# Plan: Theme / Flavor Abstraction

> **Goal**: Decouple display strings (names, icons, labels) from game mechanics
> so that adding a new visual theme to an existing mode (e.g. a sci-fi skin for
> the idler) requires only a new data object + CSS block — zero logic changes.

---

## Terminology

| Term               | Meaning                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**           | A gameplay archetype (clicker, idler). Defines mechanics, modifiers, tick logic.                                                      |
| **Theme / Flavor** | A cosmetic skin for a mode. Defines display names, icons, descriptions, CSS class. Doesn't change any numeric constants or mechanics. |

---

## Current State — Where Display Strings Are Hardcoded

| Severity   | File                                                                                  | What's hardcoded                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **High**   | `play-panel.ts`                                                                       | Two separate render functions for clicker/idler; literal `'Wood'`/`'Ale'` card labels; literal resource keys in DOM ids and state reads |
| **High**   | `idler.ts`                                                                            | `IdlerHighlight = 'wood' \| 'ale'`; all upgrade names, descriptions, generator names/icons                                              |
| **Medium** | `end.ts`                                                                              | `state.mode === 'idler'` branching for score label (`'Total'` vs `'Score'`) and stats visibility                                        |
| **Medium** | `components.ts`                                                                       | `getResourceIcon('currency')` hardcoded in clicker upgrades; tree fallback to `'wood'`                                                  |
| **Medium** | `resources.ts`                                                                        | Global `RESOURCE_ICONS` only has 3 entries; not per-theme                                                                               |
| **Low**    | `types.ts`                                                                            | `GameMode = 'clicker' \| 'idler'` — needs extension for new modes                                                                       |
| **None**   | `playing.ts`, `generators-panel.ts`, `helpers.ts`, `modes/index.ts`, `modes/types.ts` | Already fully generic                                                                                                                   |

---

## Proposed Changes

### Step 0 — Rename all IDs to abstract slots (shared + client + server)

Replace all concrete resource keys, upgrade IDs, and generator IDs with
abstract, position-based identifiers:

**Resources:**

| Old key      | New key | Used by |
| ------------ | ------- | ------- |
| `'currency'` | `'r0'`  | clicker |
| `'wood'`     | `'r0'`  | idler   |
| `'ale'`      | `'r1'`  | idler   |

**Upgrades:**

| Old id               | New id | Mode    |
| -------------------- | ------ | ------- |
| `'double-click'`     | `'u0'` | clicker |
| `'multiplier'`       | `'u1'` | clicker |
| `'coronation'`       | `'u2'` | clicker |
| `'sharpened-axes'`   | `'u0'` | idler   |
| `'heavy-logging'`    | `'u1'` | idler   |
| `'royal-brewery'`    | `'u2'` | idler   |
| `'master-craftsmen'` | `'u3'` | idler   |
| `'industrial-era'`   | `'u4'` | idler   |
| `'royal-throne'`     | `'u5'` | idler   |

**Generators:**

| Old id         | New id | Mode    |
| -------------- | ------ | ------- |
| `'cursor'`     | `'g0'` | clicker |
| `'intern'`     | `'g1'` | clicker |
| `'factory'`    | `'g2'` | clicker |
| `'woodcutter'` | `'g0'` | idler   |
| `'brewer'`     | `'g1'` | idler   |
| `'sawmill'`    | `'g2'` | idler   |
| `'tavern'`     | `'g3'` | idler   |

This is a mechanical find-and-replace across the entire codebase: mode
definitions, modifiers, costs, prerequisites, `PlayerState.resources`,
`PlayerState.upgrades`, `PlayerState.generators`, server validation, tests.
After this step, no code anywhere mentions `'wood'`, `'sharpened-axes'`, or
`'cursor'` — all identifiers are purely positional (`'r0'`, `'u0'`, `'g0'`).

Affected locations:

- `idler.ts`: `resources: ['r0', 'r1']`, `scoreResource: 'r0'`,
  `costCurrency: 'r0'`/`'r1'`, modifier fields, `initialResources`,
  `initialMeta: { highlight: 'r0' }`, generator production resources,
  upgrade IDs and prerequisites, generator IDs
- `clicker.ts`: `resources: ['r0']`, `scoreResource: 'r0'`,
  `costCurrency: 'r0'`, modifier fields, upgrade IDs, generator IDs
- `play-panel.ts`: DOM ids become `card-r0` / `card-r1`, state reads become
  `state.player.resources['r0']`
- `hotkeys.ts`, `match.ts` (server): `set_highlight` validates against
  `modeDef.resources` instead of a hardcoded set
- `collectIdlerDynamic`: references `state.upgrades['u0']` instead of
  `state.upgrades['sharpened-axes']`
- All tests: update resource keys, upgrade IDs, generator IDs

> **Note:** IDs are scoped per mode — both clicker and idler use `'u0'`, `'g0'`,
> etc. independently. There is no cross-mode collision because a match only ever
> runs one mode.

> **Why `'r0'`/`'u0'`/`'g0'` instead of numeric 0/1/2?** `PlayerState.resources`
> is `Record<string, number>`, modifier `field` values are strings, and
> `PlayerState.upgrades`/`generators` are `Record<string, number>`. Switching
> the entire state system to numeric-indexed arrays would be a much larger
> change. String-based `'r0'` gives the decoupling benefit while fitting the
> existing infrastructure.

### Step 1 — Add `ModeFlavor` to `ModeDefinition` (shared)

Add a `flavor` object to `ModeDefinition` that carries all display metadata:

```ts
interface ResourceFlavor {
  /** Abstract resource key (e.g. 'r0', 'r1'). Matches keys in resources[]. */
  readonly key: string
  /** Human-readable name shown in UI (e.g. 'Wood', 'Gold'). */
  readonly displayName: string
  /** Emoji icon (e.g. '🪵', '💰'). */
  readonly icon: string
  /** Optional CSS class applied to the resource item (e.g., 'gold'). */
  readonly className?: string
}

interface UpgradeFlavor {
  /** Upgrade id. */
  readonly id: string
  /** Display name (e.g. '🪓 Sharpened Axes'). */
  readonly name: string
  /** Display description (e.g. 'Highlight boost → 4×'). */
  readonly description: string
}

interface GeneratorFlavor {
  /** Generator id. */
  readonly id: string
  /** Display name (e.g. 'Woodcutter'). */
  readonly name: string
  /** Display icon (e.g. '🪓'). */
  readonly icon: string
}

interface ModeFlavor {
  /** CSS class applied to the playing-screen root (e.g. 'theme-medieval'). */
  readonly themeClass: string
  /** Label for the score in scoreboards/end screens (e.g. 'Score', 'Total'). */
  readonly scoreLabel: string
  /** Resource display metadata, ordered for the header bar. */
  readonly resources: readonly ResourceFlavor[]
  /** Whether to show click-based stats (Clicks, Peak CPS) on the end screen. */
  readonly showClickStats: boolean
  /** Display overrides for upgrades, keyed by upgrade id. */
  readonly upgrades: readonly UpgradeFlavor[]
  /** Display overrides for generators, keyed by generator id. */
  readonly generators: readonly GeneratorFlavor[]
}
```

Each `ModeDefinition` gets a `readonly flavor: ModeFlavor` field.

In upgrade/generator definitions, `name`, `description`, and `icon` become
**mechanical IDs only** (or are removed). At render time, the client looks up
display strings from `modeDef.flavor.upgrades` / `modeDef.flavor.generators`
by id.

Example:

```ts
// idler.ts
flavor: {
  themeClass: 'theme-medieval',
  scoreLabel: 'Total',
  showClickStats: false,
  resources: [
    { key: 'r0', displayName: 'Wood', icon: '🪵' },
    { key: 'r1', displayName: 'Ale',  icon: '🍺' },
  ],
  upgrades: [
    { id: 'u0', name: '🪓 Sharpened Axes', description: 'Highlight boost → 4× (from 2×)' },
    { id: 'u1', name: '🌲 Heavy Logging',  description: '+5 base 🪵/sec' },
    // ...
  ],
  generators: [
    { id: 'g0', name: 'Woodcutter', icon: '🪓' },
    { id: 'g1', name: 'Brewer',     icon: '🍺' },
    // ...
  ],
}

// clicker.ts
flavor: {
  themeClass: 'theme-clicker',
  scoreLabel: 'Score',
  showClickStats: true,
  resources: [
    { key: 'r0', displayName: 'Gold', icon: '💰', className: 'gold' },
  ],
  upgrades: [
    { id: 'u0', name: 'Double Click', description: '×2 per click' },
    // ...
  ],
  generators: [
    { id: 'g0', name: 'Cursor', icon: '🖱️' },
    // ...
  ],
}
```

### Step 2 — Delete `resources.ts`; add flavor-based helpers (shared)

Delete the global `RESOURCE_ICONS` map and `getResourceIcon()`. Replace with
flavor-based lookups:

```ts
// In shared/src/flavor.ts (new file, replaces resources.ts)
export function getResourceIcon(flavor: ModeFlavor, key: string): string {
  return flavor.resources.find((r) => r.key === key)?.icon ?? key
}

export function getResourceName(flavor: ModeFlavor, key: string): string {
  return flavor.resources.find((r) => r.key === key)?.displayName ?? key
}

export function getUpgradeName(flavor: ModeFlavor, id: string): string {
  return flavor.upgrades.find((u) => u.id === id)?.name ?? id
}

export function getUpgradeDescription(flavor: ModeFlavor, id: string): string {
  return flavor.upgrades.find((u) => u.id === id)?.description ?? ''
}

export function getGeneratorName(flavor: ModeFlavor, id: string): string {
  return flavor.generators.find((g) => g.id === id)?.name ?? id
}

export function getGeneratorIcon(flavor: ModeFlavor, id: string): string {
  return flavor.generators.find((g) => g.id === id)?.icon ?? '?'
}
```

No global state. Every call site passes the active flavor explicitly.
All callers already have access to `modeDef` (and thus `modeDef.flavor`).

### Step 3 — Simplify `ResourceDisplay` in `mode-ui.ts` (client)

`ResourceDisplay` currently only has `key` and `className`. With flavor, we can
drop the separate `mode-ui.ts` resource config entirely — the header bar
iterates `modeDef.flavor.resources` directly. `className` (the CSS `'gold'`
class for clicker) can move into `ResourceFlavor` or be derived from
`themeClass`.

### Step 4 — Generalize `play-panel.ts` (client)

The two separate render functions (`renderClickerContent` / `renderIdlerContent`)
should be unified. The idler content is a "highlight picker" panel = a list of
resource cards. The clicker content is a "click button + upgrades" panel.

These are fundamentally different panel _types_, not different themes. The
distinction should be driven by a mode-level flag (e.g. `clicksEnabled` — which
already exists), not by `state.mode === 'idler'`:

- If `clicksEnabled`: render click button + play upgrades
- Else: render highlight resource cards (reading names/icons from flavor)

The hardcoded `'Wood'` / `'Ale'` become `getResourceName(flavor, 'r0')`.
DOM ids like `card-wood` become `card-r0`.

### Step 5 — Generalize `end.ts` (client)

Replace:

```ts
const isIdler = state.mode === 'idler'
const scoreLabel = isIdler ? 'Total' : 'Score'
```

With:

```ts
const scoreLabel = modeDef.flavor.scoreLabel
const showClickStats = modeDef.flavor.showClickStats
```

### Step 6 — Fix remaining hardcoded icon lookups (client)

- `components.ts` `renderClickerUpgrades`: replace `getResourceIcon('currency')`
  with `getResourceIcon(flavor, modeDef.scoreResource)` (which resolves to `'r0'`).
- `components.ts` `renderUpgradeTree`: replace fallback `?? 'wood'` with
  `?? modeDef.scoreResource` (now `'r0'`).
- All upgrade/generator rendering: read `name`, `description`, `icon` from
  `modeDef.flavor.upgrades` / `modeDef.flavor.generators` instead of from the
  definition objects directly.

### Step 7 — Add `data-theme` to the playing screen root (client)

In `playing.ts`, apply `modeDef.flavor.themeClass` as a class on `.playing-screen`.
Theme-specific CSS rules can then scope to `.theme-medieval .currency-card { ... }`.

### Step 8 — Generalize `IdlerHighlight` type (shared)

Replace `type IdlerHighlight = 'wood' | 'ale'` with a generic approach:

```ts
// The highlight is just one of the mode's resource keys.
// Type it as string; runtime validation ensures it's in resources[].
```

`getHighlight()` already returns a string — just remove the narrow union type
and validate against `modeDef.resources` at the `set_highlight` action handler.

### Step 9 — Add flavor validation (shared)

Add a `validateModeDefinition(id, def)` function that checks flavor ↔ mechanics
agreement. Called once per mode at registration time in `modes/index.ts`:

```ts
function validateModeDefinition(id: string, def: ModeDefinition): void {
  const f = def.flavor

  // Resource keys must match exactly (same set, same count)
  const mechKeys = new Set(def.resources)
  const flavorKeys = new Set(f.resources.map((r) => r.key))
  if (mechKeys.size !== flavorKeys.size || ![...mechKeys].every((k) => flavorKeys.has(k)))
    throw new Error(`[${id}] flavor.resources keys don't match mode.resources`)

  // Every mechanical upgrade must have a flavor entry
  for (const u of def.upgrades) {
    if (!f.upgrades.some((fu) => fu.id === u.id))
      throw new Error(`[${id}] missing flavor for upgrade '${u.id}'`)
  }

  // Every mechanical generator must have a flavor entry
  for (const g of def.generators) {
    if (!f.generators.some((fg) => fg.id === g.id))
      throw new Error(`[${id}] missing flavor for generator '${g.id}'`)
  }

  // No orphan flavor entries (flavor references nonexistent mechanic)
  for (const fu of f.upgrades) {
    if (!def.upgrades.some((u) => u.id === fu.id))
      throw new Error(`[${id}] flavor references unknown upgrade '${fu.id}'`)
  }
  for (const fg of f.generators) {
    if (!def.generators.some((g) => g.id === fg.id))
      throw new Error(`[${id}] flavor references unknown generator '${fg.id}'`)
  }
}
```

Called at registration time — the app won't start if a flavor is incomplete:

```ts
// modes/index.ts
for (const [id, def] of Object.entries(MODE_REGISTRY)) {
  validateModeDefinition(id, def)
}
```

### Step 10 — Add flavor validation test suite (shared)

A `shared/tests/flavor.test.ts` that iterates all registered modes and
asserts the same invariants as `validateModeDefinition`. This provides:

- CI-level guardrail (catches breakage even if the app isn't started)
- Better error output via test runner
- A place to add future invariants (e.g., costCurrency references valid
  resource keys, prerequisites reference valid upgrade IDs)

```ts
import { MODE_REGISTRY } from './modes/index.js'

for (const [id, def] of Object.entries(MODE_REGISTRY)) {
  describe(`${id} flavor`, () => {
    it('resource keys match between mechanics and flavor', () => { ... })
    it('every upgrade has a flavor entry', () => { ... })
    it('every generator has a flavor entry', () => { ... })
    it('no orphaned flavor entries', () => { ... })
  })
}
```

---

## What Does NOT Change

- **All numeric constants** — costs, rates, scaling, durations, modifier values
- **Upgrade/generator mechanics** — prerequisites, repeatable, categories
- **Server validation & match logic** — operates on resource keys, not display
- **Test assertions on behavior** — no logic changes, so tests stay green
  (display-string assertions in tests may need updating)

---

## Files Touched (estimated)

| File                                       | Change type                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/modes/types.ts`                | Add `ModeFlavor`, `ResourceFlavor`, `UpgradeFlavor`, `GeneratorFlavor` interfaces; add `flavor` to `ModeDefinition`                                                                          |
| `shared/src/resources.ts`                  | **Delete** — replaced by `shared/src/flavor.ts`                                                                                                                                              |
| `shared/src/flavor.ts`                     | **New** — `getResourceIcon`, `getResourceName`, `getUpgradeName`, `getUpgradeDescription`, `getGeneratorName`, `getGeneratorIcon`                                                            |
| `shared/src/index.ts`                      | Re-export `flavor.ts` instead of `resources.ts`                                                                                                                                              |
| `shared/src/modes/idler.ts`                | Rename all `'wood'`→`'r0'`, `'ale'`→`'r1'`; add `flavor` object with upgrade/generator display data; remove `IdlerHighlight` type; move `name`/`description` out of upgrade defs into flavor |
| `shared/src/modes/clicker.ts`              | Rename `'currency'`→`'r0'`; add `flavor` object; move `name`/`description` out of upgrade/generator defs into flavor                                                                         |
| `shared/src/types.ts`                      | Remove `name`, `description` from `UpgradeDefinition`; remove `name`, `icon` from `GeneratorDefinition` (display comes from flavor)                                                          |
| `client/src/ui/mode-ui.ts`                 | Simplify `ResourceDisplay`; derive from `modeDef.flavor.resources`                                                                                                                           |
| `client/src/ui/panels/play-panel.ts`       | Unify render functions; read labels/icons from flavor; rename DOM ids (`card-r0`, etc.)                                                                                                      |
| `client/src/ui/playing.ts`                 | Apply `themeClass`; pass flavor to resource bar                                                                                                                                              |
| `client/src/ui/end.ts`                     | Replace `isIdler` checks with flavor fields                                                                                                                                                  |
| `client/src/ui/components.ts`              | Use flavor for all icon/name lookups                                                                                                                                                         |
| `client/src/ui/panels/generators-panel.ts` | Read name/icon from flavor instead of def                                                                                                                                                    |
| `client/src/style.css`                     | Add `.theme-medieval`, `.theme-clicker` root classes (optional, prep only)                                                                                                                   |
| `shared/src/modes/index.ts`                | Add `validateModeDefinition`, call at registration time                                                                                                                                      |
| `shared/tests/flavor.test.ts`              | **New** — flavor validation test suite                                                                                                                                                       |
| `server/src/match.ts`                      | Validate `set_highlight` against `modeDef.resources` (generic) instead of hardcoded set                                                                                                      |
| Tests (multiple)                           | Update all ID literals (`'wood'`→`'r0'`, `'sharpened-axes'`→`'u0'`, etc.) and display-string assertions                                                                                      |

---

## Resolved Questions

1. **Should upgrade/generator names live in the flavor too?**
   **Yes** — do it now. `ModeFlavor` includes `upgrades: UpgradeFlavor[]` and
   `generators: GeneratorFlavor[]` with display name, description, and icon.
   The mechanical definitions (`UpgradeDefinition`, `GeneratorDefinition`) drop
   their `name`, `description`, and `icon` fields.

2. **Should `getResourceIcon` keep a backward-compatible 1-arg signature?**
   **No** — use the explicit 2-arg `(flavor, key)` form. The global
   `RESOURCE_ICONS` map is deleted. All callers pass flavor explicitly.

3. **Should `RESOURCE_ICONS` remain as a global fallback?**
   **No** — drop it entirely. Flavor is the sole source of display metadata.
   Contexts without a mode (e.g. lobby) don't show resource icons.

---

## Implementation Order

The prep commit can be done incrementally in this order:

1. Rename all IDs: resources (`'currency'`→`'r0'`, `'wood'`→`'r0'`, `'ale'`→`'r1'`), upgrades (`'sharpened-axes'`→`'u0'`, etc.), generators (`'cursor'`→`'g0'`, etc.) across entire codebase
2. Add types (`ModeFlavor`, `ResourceFlavor`, `UpgradeFlavor`, `GeneratorFlavor`) to shared
3. Add `flavor` to clicker + idler mode definitions (with upgrade/generator display data)
4. Strip `name`/`description`/`icon` from mechanical definitions (`UpgradeDefinition`, `GeneratorDefinition`)
5. Create `shared/src/flavor.ts` with helpers; delete `shared/src/resources.ts`
6. Update client call sites (play-panel → end → components → generators-panel → playing → mode-ui)
7. Remove `IdlerHighlight` type; generalize highlight handling and server validation
8. Add `validateModeDefinition` to `modes/index.ts`; add `shared/tests/flavor.test.ts`
9. Add theme CSS classes (empty rules, just scaffolding)
10. Run tests, fix all ID + display-string assertions
11. Commit
