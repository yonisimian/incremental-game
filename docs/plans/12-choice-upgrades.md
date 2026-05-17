# PLAN: Choice Upgrades

## Status: Draft

---

## Problem Statement

The current upgrade tree model treats every node as independent. Some upgrade designs should instead present mutually exclusive choices.

Example:

- choose one of three elemental upgrades
- pick a defensive or offensive branch
- select a singular specialization path

---

## Goals

- Support upgrade groups where only one option may be purchased.
- Make choice groups explicit in mode definitions.
- Reflect selection state clearly in the UI.
- Enforce exclusivity in both client and server validation.

---

## Design Proposal

Add optional group metadata to upgrades:

```ts
export interface UpgradeDefinition {
  readonly id: UpgradeId
  readonly maxLevel: number
  readonly choiceGroup?: string
  readonly choiceLabel?: string
  // ...
}
```

Semantics:

- upgrades with the same `choiceGroup` are mutually exclusive
- purchasing one choice disables all others in the group
- the group itself may remain visible for clarity

---

## Validation Logic

Shared validation should ensure:

- no two upgrades in a choice group can both be owned
- purchasing a choice when another is already purchased is rejected
- group identifiers are stable and non-empty

For upgrades with `maxLevel > 1`, choice groups can still apply if the group is intended to be a single specialization.

---

## UI Behavior

Render choice groups with clear visual affordances:

- group label or header above sibling choices
- highlight selected option and dim unavailable siblings
- show a locked state for sibling choices once one is chosen
- use text like `Choose one:` or `Selected` badges

If a choice is unselected, allow normal purchase flow.

---

## Client / Server Alignment

- `canBuyUpgrade` must reject upgrades if a different sibling has already been bought.
- server validation must treat the chosen group as authoritative.
- client should still render all group members but disable invalid purchases.

If a client sends a choice upgrade purchase, the server should validate the group constraint before applying it.

---

## Extensibility

Future variants may include:

- `choiceGroupMaxSelected: 1 | N`
- mutually exclusive groups spanning both flat and tree upgrades
- one-time group selection bonuses

For now, implement the simple `one-choice-per-group` case.

---

## Testing Strategy

Cover:

- valid purchase of one choice in a group
- rejecting a second purchase in the same group
- non-group upgrades remain unaffected
- UI disables sibling upgrades once a choice is owned
