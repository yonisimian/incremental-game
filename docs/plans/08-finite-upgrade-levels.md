# Finite Upgrade Level — Design & Implementation Plan

> **Note**: The implementation evolved from this plan. `maxLevel` was renamed to
> `purchaseLimit` with inverted default semantics: `0` = unlimited, `1` (default) = one-shot,
> `N > 1` = finite. The `repeatable` field was removed entirely. Helper functions
> `isMaxed()`, `getPurchaseLimit()`, and `isUnlimited()` centralize the logic.

## Goal

Add support for finite-level upgrades in the upgrade system using only `maxLevel` semantics. This simplifies upgrade type handling, eliminates redundant or conflicting states, and makes behavior fully derived from whether `maxLevel` is defined.

## Summary

This plan replaces the previous `repeatable` / `maxLevel` hybrid model with a single, clean `maxLevel`-based design. The first implementation keeps same cost per level, linear level scaling, and no additional balance changes. Existing save data remains compatible because upgrade ownership is already stored as numeric levels.

---

## Requirements (restated)

- Use `maxLevel` as the sole upgrade kind discriminator.
- `maxLevel: 1` = single purchase.
- `maxLevel: N` = finite repeatable purchase capped at `N` levels.
- `maxLevel` undefined = infinite repeatable purchase.
- Same cost per level initially.
- Modifiers are applied once per purchased level.
- Preserve existing save compatibility with numeric upgrade levels.
- Provide clear UI feedback for level progress and capped upgrades.

---

## High-level design

Upgrade kind is entirely derived from `maxLevel`:

- Single-purchase: `maxLevel: 1`
- Finite repeatable: `maxLevel: 3`, `5`, `7`, etc.
- Infinite repeatable: `maxLevel` omitted

Purchase behavior:

- If `maxLevel` is defined, purchases are allowed only while `currentLevel < maxLevel`.
- If `maxLevel` is undefined, purchases are allowed indefinitely.

Modifier behavior:

- Each purchased level applies the upgrade modifiers once.
- Current level scaling is linear, and every level uses the same cost.

---

## Data model / API changes

Update `UpgradeDefinition` in `shared/src/types.ts`:

- Remove `repeatable` from the model entirely.
- Add `maxLevel?: number`.

Continue using `PlayerState.upgrades: Record<string, number>` to track `currentLevel`.

Interpretation:

- `0` means unowned.
- `1` means purchased once.
- `n` means purchased `n` times.

This is backward-compatible with current saves because existing numeric upgrade counts already encode level.

Example type:

```ts
interface UpgradeDefinition {
  id: string
  cost: number
  costCurrency?: string
  maxLevel?: number
  modifiers: readonly Modifier[]
  category?: UpgradeCategory
  prerequisites?: readonly string[]
  position?: UpgradePosition
  goalType?: Goal['type']
}
```

Notes:

- `maxLevel: 1` explicitly represents single-purchase upgrades.
- `maxLevel` undefined represents infinite repeatable upgrades.
- `maxLevel: N` with `N > 1` represents finite repeatable upgrades.

---

## Purchase validation logic

Use `maxLevel` as the sole decision point for purchase eligibility:

1. Lookup `UpgradeDefinition` for `upgradeId`.
2. Let `currentLevel = state.upgrades[upgradeId] ?? 0`.
3. If `maxLevel` is defined:
   - Allow purchase only when `currentLevel < maxLevel`.
   - If `currentLevel >= maxLevel`, disallow purchase.
4. If `maxLevel` is undefined:
   - Allow purchase indefinitely.

Expected behavior:

- `maxLevel: 1` acts as a one-shot upgrade.
- `maxLevel: N` acts as a finite upgrade capped at `N` levels.
- `maxLevel` undefined acts as an infinite repeatable upgrade.

Implementation notes:

- `applyPurchase(state, upgradeId, mode)` should deduct cost and increment `currentLevel` only if valid.
- If purchase cannot proceed, state must remain unchanged and the caller should receive a failure result.
- Keep logic atomic and easy to test.

---

## Modifier behavior

- Modifiers are applied once per purchased level.
- Level scaling is currently linear: owning `n` levels applies `n` copies of the upgrade modifiers.
- All levels currently use the same cost.

Example:

A finite upgrade with `modifiers: [{ stage: 'additive', field: 'r0', value: 2 }]` and `currentLevel = 3` contributes `+6` total.

---

## State persistence

No save format change is required.

- `PlayerState.upgrades` remains a numeric record.
- Loaded numeric counts represent `currentLevel`.
- When `maxLevel` is defined, clamp loaded counts to at most `maxLevel`.

Migration step:

- During load, for each upgrade in `state.upgrades`, if the active mode defines `maxLevel` and the saved count exceeds it, set `state.upgrades[upgradeId] = maxLevel`.

---

## UI display behavior

Update client upgrade rendering to derive behavior from `maxLevel` only:

- If `maxLevel` is defined, show progress as `currentLevel / maxLevel`.
- If `currentLevel === maxLevel`, render the upgrade as completed and disable purchase.
- If `maxLevel` is undefined, keep purchases enabled indefinitely and optionally show current level when helpful.
- Do not rely on a deprecated `repeatable` flag in the UI.

Completed state:

- Finite upgrades at cap should appear completed, either via `.owned` styling or a new `.completed` class.
- Tooltip/ARIA text should communicate the upgrade is fully upgraded.

---

## Level tracking and rendering

- Maintain `state.upgrades[id]` as `currentLevel`.
- Rendering logic branches on `def.maxLevel`:
  - `maxLevel: 1` → single-purchase style.
  - `maxLevel: N` → finite progress style.
  - `maxLevel` undefined → infinite style.
- Disable purchase when `currentLevel >= maxLevel` for defined caps.

---

## Compatibility with existing upgrades

- Existing single-purchase upgrades are still valid if treated as `maxLevel: 1` conceptually.
- Existing infinite repeatable upgrades are still valid by leaving `maxLevel` undefined.
- Existing save data remains compatible because it stores numeric upgrade levels.

Legacy definitions may be migrated to explicit `maxLevel` values in a future cleanup, but that is not required for compatibility.

---

## Testing strategy

Shared tests (`shared/tests/modes.test.ts`):

- Single purchase:
  - `maxLevel: 1` can be purchased once; second purchase fails.
- Finite repeatable:
  - `maxLevel: N` increments from 0 to `N` and rejects further purchases.
- Infinite repeatable:
  - no `maxLevel` increments indefinitely.
- Modifier scaling:
  - owning `n` levels applies modifiers `n` times.
- Persistence normalization:
  - loaded `currentLevel` above `maxLevel` is clamped.

Client tests (`client/tests/components.test.ts`):

- Progress badge rendering for finite upgrades.
- Completed styling when `currentLevel === maxLevel`.
- Infinite upgrades remain buyable after many levels.

Integration tests:

- Simulate repeated purchases across single, finite, and infinite upgrades and verify state/UI.

---

## Example upgrade definitions

- Single purchase:

```ts
{ id: 'u1', cost: 25, costCurrency: 'r0', maxLevel: 1, modifiers: [{ stage: 'additive', field: 'r0', value: 5 }] }
```

- Finite repeatable:

```ts
{ id: 'uF1', cost: 20, costCurrency: 'r0', maxLevel: 5, modifiers: [{ stage: 'additive', field: 'r0', value: 2 }] }
```

- Infinite repeatable:

```ts
{ id: 'u3', cost: 10, costCurrency: 'r1', modifiers: [{ stage: 'additive', field: 'r0', value: 5 }] }
```

Notes: `maxLevel` undefined means infinite purchases are allowed.

---

## Implementation notes — shared game logic

1. Remove `repeatable` from `UpgradeDefinition` and support only `maxLevel?: number`.
2. Update purchase validation in `applyPurchase` to use `maxLevel` only.
3. Keep `state.upgrades[upgradeId]` numeric and increment by 1 on successful purchase.
4. Clamp loaded counts to `maxLevel` on load.
5. Continue applying modifiers linearly per level.

---

## Implementation notes — client rendering & upgrade tree UI

1. Upgrade rendering should derive status from `def.maxLevel` and `currentLevel`.
2. Show `Lv. {currentLevel}/{maxLevel}` only when `maxLevel` is defined.
3. When capped, disable the buy button and show completed appearance.
4. For infinite upgrades, show current level when helpful, but do not cap purchases.
5. Ensure buy-all / auto-buy helpers respect `maxLevel`.

---

## Save / Load compatibility

- No schema change required for saves; `state.upgrades` remains numeric.
- On load, clamp values to `maxLevel` where defined.

---

## Example test cases (concise)

- `maxLevel: 1`: purchase once, second purchase fails.
- `maxLevel: 5`: purchase five times, sixth purchase fails.
- `maxLevel` undefined: purchase indefinitely.
- `currentLevel` greater than `maxLevel` on load is reduced to `maxLevel`.

---

## Future considerations

- Cost scaling per level (e.g., linear, exponential).
- Per-level modifiers or per-level modifier definitions.
- Prestige interactions for finite upgrade progress.
- UI progress bars and purchase animations.

---

## Implementation steps (suggested priorities)

1. Remove `repeatable` from `UpgradeDefinition` and add `maxLevel?: number`.
2. Update purchase logic to use `maxLevel` only.
3. Add load-time clamping to enforce `maxLevel`.
4. Update client UI to render `currentLevel / maxLevel` and completed state.
5. Add tests for single, finite, and infinite upgrade behavior and run the full suite.
