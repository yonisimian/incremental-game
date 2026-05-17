# PLAN: Dynamic-Cost Multi-Purchase Upgrades

## Status: Draft

---

## Problem Statement

Current multi-purchase upgrades assume a fixed per-level cost. This limits design flexibility for upgrades that should become more expensive with each purchase.

A dynamic-cost system enables:

- upgrades with escalating cost per level
- buy-max / bulk purchases for level-based upgrades
- better pacing for progression-based upgrades

---

## Goals

- Support dynamic cost formulas for repeatable or level-gated upgrades.
- Keep validation and bulk purchase logic correct.
- Expose helper APIs for current cost, next cost, and bulk cost.
- Keep the upgrade definition shape simple.

---

## Definition Proposal

Extend upgrade definitions with optional cost dynamics:

```ts
export interface UpgradeCostScaling {
  readonly type: 'linear' | 'exponential'
  readonly baseCost: number
  readonly factor: number
}

export interface UpgradeDefinition {
  readonly id: UpgradeId
  readonly maxLevel: number
  readonly cost: number
  readonly costScaling?: UpgradeCostScaling
  // ...
}
```

Semantics:

- no `costScaling` = fixed cost per level
- `linear` means `cost + factor * level`
- `exponential` means `cost * factor^level`

---

## Cost Computation Helpers

Shared functions should compute:

- `getUpgradeNextCost(def, currentLevel)`
- `getUpgradeBulkCost(def, currentLevel, levelsToBuy)`
- `getMaxAffordableUpgradeLevels(def, currentLevel, budget)`

For `exponential` scaling, use geometric-series formulas.
For `linear` scaling, use arithmetic-series formulas.

---

## Purchase Flow

`buyUpgrade` should:

- determine current owned level
- compute desired purchase quantity
- validate `currentLevel + quantity <= maxLevel`
- compute exact total cost
- reject if budget insufficient

For single-level buys, reuse `getUpgradeNextCost`.

---

## Client / Server Consistency

Both client and server must use the same pricing helpers.

Shared validation must reject:

- purchases beyond `maxLevel`
- purchases with stale budget estimates
- malformed `costScaling` definitions

Prefer shared helper code in `shared/` for both validation and gameplay.

---

## UI Considerations

Upgrade cards should show:

- current level / max level
- next-level cost
- bulk cost for max purchasable levels when `buy-max` is enabled

When an upgrade is capped, show `Maxed`.
For dynamic-cost upgrades, show `Cost increases each level` in a tooltip.

---

## Testing Strategy

Unit tests should assert:

- `getUpgradeNextCost` for fixed, linear, and exponential scaling
- `getUpgradeBulkCost` for multiple levels
- affordability calculation from a budget
- validation rejects purchases beyond max level
- UI displays correct next cost and capped state
