# Finite Upgrade Level — Design & Implementation Plan

## Goal

Add support for finite-level (bounded repeatable) upgrades to the upgrade system so an upgrade can be purchased up to a configured maximum number of times (e.g. 3, 5, 7), while keeping existing single-purchase and infinite-repeatable upgrades unchanged.

## Summary

This plan introduces a minimal, backward-compatible model for finite repeatable upgrades. The first implementation uses the same cost per level, no cost-scaling and no balance changes. The design covers data model changes, purchase validation, persistence, UI display, tests, and migration/compatibility concerns.

---

## Requirements (restated)

- Support finite repeatable upgrades with a configurable `maxLevel`.
- Level purchases use the same cost for every level initially.
- Preserve existing semantics for single-purchase upgrades and infinite (repeatable) upgrades.
- Provide clear UI feedback for current level and when an upgrade is fully completed.
- Tests covering model, purchases, persistence, and UI rendering.

---

## High-level design

Introduce three mutually-distinguishable upgrade kinds:

- Single-purchase: existing behavior (buy once).
- Infinite repeatable: existing `repeatable` behavior (no max level).
- Finite repeatable: new behavior with `maxLevel` where purchases stop when `currentLevel === maxLevel`.

Data model changes are intentionally small: extend `UpgradeDefinition` metadata and `PlayerState.upgrades` usage to track current levels where needed.

---

## Data model / API changes

Proposed minimal additions to the upgrade types in `shared/src/types.ts` or wherever `UpgradeDefinition` is declared:

- In `UpgradeDefinition` (optional fields):
  - `maxLevel?: number` — when present and > 0 indicates finite repeatable upgrade (max allowed purchases).
  - `repeatable?: boolean` — existing field kept for backward compatibility; `repeatable && !maxLevel` => infinite repeatable.

- In `PlayerState.upgrades` (no breaking change):
  - Current implementation maps upgrade IDs to numeric counts already (e.g. `{ u1: 0 }`). Keep this and interpret the number uniformly as `currentLevel`:
    - Single-purchase upgrade: `currentLevel` is 0 or 1.
    - Infinite repeatable: `currentLevel` is the number of purchases.
    - Finite repeatable: `currentLevel` is number of purchases (0..maxLevel).

Type sketch (conceptual):

- `interface UpgradeDefinition { id: string; cost: number; costCurrency?: string; repeatable?: boolean; maxLevel?: number; modifiers: Modifier[]; ... }
- `PlayerState.upgrades: Record<string, number>` — unchanged.

Notes:

- No new runtime shape for `PlayerState` is necessary; the existing numeric value is suitable as `currentLevel`.
- Prefer `maxLevel` over an `infiniteRepeatable` boolean; `repeatable: true` plus missing `maxLevel` remains infinite.

---

## Purchase validation logic

Centralize purchase validation in `shared/src/modes/index.ts` or `shared/src/index.ts` (the module responsible for `applyPurchase` and game rules).

Rules:

1. Lookup `UpgradeDefinition` for `upgradeId`.
2. Let `currentLevel = state.upgrades[upgradeId] ?? 0`.
3. If the upgrade has `maxLevel` defined:
   - If `currentLevel >= maxLevel` → disallow purchase (already at cap).
   - Else allow purchase (increment `currentLevel` by 1).
4. Else if `upgrade.repeatable` is true and no `maxLevel` → allow unlimited purchases (current behavior).
5. Else (no `repeatable` and no `maxLevel`) → treat as single-purchase: allow only if `currentLevel === 0`.

Implementation notes:

- Keep `applyPurchase(state, upgradeId, mode)` semantics identical in terms of cost deduction and failure modes. Only alter the upgrade-count increment logic to honor `maxLevel`.
- Ensure purchases are atomic (cost deduction then increment); tests should exercise rollback semantics whenever a purchase would be illegal.

Edge cases:

- `maxLevel === 1` is equivalent to a single-purchase upgrade. Either representation is allowed but prefer single-purchase upgrades to be declared without `repeatable`/`maxLevel` for clarity.

---

## State persistence

- No changes needed to the serialized save format: the upgrade counts are already numeric per `PlayerState.upgrades` and continue to represent `currentLevel`.
- On loading older saves, existing numeric counts remain valid.
- On loading newer saves with upgrades that define `maxLevel`, ensure UI clamps and treats any existing `currentLevel > maxLevel` as `maxLevel` (migration step). Prefer to log/warn if such mismatch occurs.

Migration step (load path):

- When reading a saved `PlayerState`, for every `upgradeId` in `state.upgrades`:
  - If `mode.upgrades` contains an upgrade with `maxLevel` and `state.upgrades[upgradeId] > maxLevel`, set `state.upgrades[upgradeId] = maxLevel`.
  - Persist the normalized value back into memory (and optionally save file on next autosave).

---

## UI display behavior

Client changes primarily in `client/src/ui/components.ts` (or wherever upgrade buttons are rendered) and the upgrade-tree rendering code:

- Each upgrade node should show `currentLevel / maxLevel` when `maxLevel` is present.
  - Example: "Level 2/5" badge or a small progress fraction overlay.
- When `currentLevel === maxLevel`, node appears visually completed:
  - Use existing `.owned` semantics for single-purchase, or add a `.completed` class for finite-complete states. `.completed` can reuse `.owned` styling for simplicity.
  - Disable the purchase action and show tooltip "Fully upgraded".
- For infinite repeatable upgrades (repeatable && !maxLevel), show current level if > 0 (e.g., `×3` or `Lv.3`), but keep buy action enabled.
- Ensure keyboard shortcuts / buy-all operations respect `maxLevel` caps.

UI guidelines:

- Minimize layout churn: add a small level badge next to upgrade cost/name, not a full layout change.
- Accessibility: include `aria-label` text that reads current level and max (e.g., "Resource Hoarders level 2 of 5").

---

## Level tracking and rendering

- Continue using `state.upgrades[id]` as `currentLevel`.
- Rendering logic reads `currentLevel` and `def.maxLevel` if present.
- Render states:
  - `currentLevel === 0`: normal unlocked/locked state applies.
  - `0 < currentLevel < maxLevel`: show progress badge and enable purchase (if resources available).
  - `currentLevel === maxLevel`: show completed appearance and disable purchase control.

---

## Compatibility with existing upgrades

- Existing single-purchase upgrades — declared without `repeatable` and `maxLevel` — remain unchanged.
- Existing infinite repeatable upgrades — declared with `repeatable: true` and no `maxLevel` — remain unchanged.
- If maintainers prefer, convert legacy single-purchase upgrades to `maxLevel: 1` explicitly; not required.

---

## Testing strategy

Add unit and integration tests in `shared/tests` and `client/tests` as follows:

Shared tests (`shared/tests/modes.test.ts`):

- Purchase validation:
  - Single-purchase cannot be bought twice.
  - Infinite repeatable increments with each purchase.
  - Finite repeatable increments up to `maxLevel`, then blocks further purchases.
- State mutation:
  - Costs deducted properly for each purchase.
  - `currentLevel` clamps to `maxLevel` when loading a legacy save with larger counts.
- Modifier effects:
  - Finite upgrades whose modifiers scale with `currentLevel` (repeatable semantics) should produce expected modifier sums.

Client tests (`client/tests/components.test.ts`):

- Rendering badge for finite upgrades.
- `.completed` (or `.owned`) class is applied when `currentLevel === maxLevel`.
- Buy button is disabled for completed upgrades.

Integration tests:

- Simulate buying levels until `maxLevel` and assert UI and `PlayerState` consistency.

---

## Example upgrade definitions

- Single purchase (existing):

```ts
{ id: 'u1', cost: 25, costCurrency: 'r0', modifiers: [{ stage: 'additive', field: 'r0', value: 5 }] }
```

- Infinite repeatable (existing):

```ts
{ id: 'u3', cost: 10, costCurrency: 'r1', repeatable: true, modifiers: [{ stage: 'additive', field: 'r0', value: 5 }] }
```

- Finite repeatable (new):

```ts
{ id: 'uF1', cost: 20, costCurrency: 'r0', repeatable: true, maxLevel: 5, modifiers: [{ stage: 'additive', field: 'r0', value: 2 }] }
```

Notes: `repeatable: true` + `maxLevel` indicates finite repeatable. The code should accept `maxLevel` without `repeatable: true` and treat the presence of `maxLevel` as an implicit repeatable definition (implementation may accept both for clarity).

---

## Implementation notes — shared game logic

1. `applyPurchase(state, upgradeId, mode)` (in `shared/src/modes/index.ts`) changes:
   - After deducting cost, increment `state.upgrades[upgradeId]` only if allowed by `maxLevel`.
   - Return success/failure status for callers (client UI) to surface errors.
2. `collectModifiers` should already treat `upgrade.repeatable` by scaling modifiers by `currentLevel`. For finite repeatable upgrades, the `currentLevel` semantic remains the same and no change to modifier application is required.
3. On state load, clamp `state.upgrades[upgradeId]` to `maxLevel` when defined.

---

## Implementation notes — client rendering & upgrade tree UI

1. Upgrade button component (e.g., `renderUpgradeButton`) reads `def.maxLevel` and `currentLevel`.
2. Show a small level badge when `def.maxLevel` is present: `Lv. {currentLevel}/{maxLevel}`.
3. When `currentLevel === maxLevel`, render as completed and disable the buy handler.
4. `buy-all` and `buy-cheapest` helpers must respect `maxLevel` and avoid overbuying.

---

## Save / Load compatibility

- No schema change required for saves; `state.upgrades` remains numeric.
- On load, clamp values to `maxLevel` and optionally autosave to update save file.

---

## Example test cases (concise)

- Buying finite to cap:
  - Given `uF1.maxLevel = 3` and resources sufficient, call `applyPurchase` three times: `currentLevel` becomes 3 and fourth purchase fails.
- UI shows `Lv.3/3` and is disabled.
- Legacy save with `currentLevel = 10` and `maxLevel = 5` becomes `5` on load.

---

## Future considerations

- Cost scaling per level (e.g., linear, exponential) — can be added later with `costScaling` or per-level `costs: number[]`.
- Per-level modifiers: support `modifiersByLevel` or allow modifiers to be interpreted as per-level when `repeatable`.
- Prestige interactions: how finite upgrades reset on prestige; define policy and tests.
- UI progress bar / animations for multi-level purchases.

---

## Implementation steps (suggested priorities)

1. Update `UpgradeDefinition` typeset to include `maxLevel?: number`.
2. Modify `applyPurchase` to respect `maxLevel` (as described above).
3. Add load-time clamping logic in `createInitialState` or the load handler.
4. Update `client` upgrade rendering to display `currentLevel / maxLevel` and `.completed` state.
5. Add tests in `shared/tests` and `client/tests` and run the full suite.
