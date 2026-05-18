# PLAN: Level-Gated Upgrade Unlocks

## Status: Draft

---

## Problem Statement

The current prerequisite system treats ownership as binary: an upgrade is either bought or not.

This blocks upgrade paths that should depend on the level of a parent upgrade, such as:

- unlock tiered branches when a core upgrade reaches level 3
- require a support upgrade to be maxed before enabling a downstream node

---

## Goals

- Allow prerequisites to express minimum owned levels.
- Keep existing single-buy prerequisites intact.
- Integrate cleanly with AND/OR prerequisite logic.
- Provide useful UI messaging about level requirements.

---

## Definition Change

Enhance prerequisite leaves to include a minimum level requirement:

```ts
export type Prerequisite =
  | { type: 'upgrade'; id: UpgradeId }
  | { type: 'upgrade'; id: UpgradeId; minLevel: number }
```

Existing `upgrade` leaves without `minLevel` remain equivalent to `minLevel: 1`.

---

## Unlock Evaluation

Update `isPrerequisiteSatisfied` to consider level:

- `upgrade` passes if `state.upgrades[id] >= minLevel`
- treat missing state as `0`
- `minLevel` of `1` preserves current buy-once semantics

This makes it possible to express requirements such as:

- `Requires u1 at level 3`
- `Requires u1 and (u2 at level 2 or u3)`

---

## Validation Rules

Mode validation should ensure:

- `minLevel` is a positive integer
- `minLevel` does not exceed the referenced upgrade’s `maxLevel`
- `upgrade.id` exists in the same mode

If a prerequisite refers to an upgrade with unlimited levels, any positive `minLevel` remains valid.

---

## UI Feedback

Show level-based lock text for gated upgrades:

- `Requires u1 level 3`
- `Requires u1 (level 2+) and u2`

For upgrade tree rendering:

- include a badge or tooltip on locked nodes
- optionally show current progress, e.g. `2 / 3`

For clarity, use the same phrasing across tree and tooltip views.

---

## Integration with Other Systems

- `canBuyUpgrade` should use the enhanced prerequisite evaluator.
- `renderUpgradeTree` should display visible requirements clearly.
- `getAvailableUpgrades` may still expose locked upgrades, but mark them as unavailable.

If a buy request is received for a locked upgrade, server validation must reject it.

---

## Testing Strategy

Unit tests should verify:

- unlocks at exact required level
- upgrades remain locked below required level
- boolean combinations with level-gated leaves
- invalid `minLevel` data is rejected
- UI text generation for level-based requirements
