# PLAN: Mixed AND/OR Upgrade Prerequisites

## Status: Draft

---

## Problem Statement

Upgrade prerequisites are currently expressed as a flat list, which implies only AND semantics.

This prevents richer upgrade paths such as:

- require either upgrade A or upgrade B
- require upgrade A and one of B or C
- build branching trees with shared prerequisites

---

## Goals

- Support AND and OR prerequisite expressions.
- Keep the expression model composable and testable.
- Preserve existing AND-only upgrades without forcing rewrite.
- Keep unlock evaluation efficient.
- Provide clear UI feedback for complex requirements.

---

## Proposed Prerequisite Model

Replace the current `prerequisites: readonly UpgradeId[]` with a recursive expression type:

```ts
export type PrerequisiteExpression =
  | { type: 'all'; items: readonly PrerequisiteExpression[] }
  | { type: 'any'; items: readonly PrerequisiteExpression[] }
  | { type: 'upgrade'; id: UpgradeId }
```

For backward compatibility, `prerequisites: ['u1', 'u2']` maps to:

```ts
{ type: 'all', items: [{ type: 'upgrade', id: 'u1' }, { type: 'upgrade', id: 'u2' }] }
```

---

## Evaluation Logic

Create a shared helper:

- `isPrerequisiteSatisfied(expr, state)`

Evaluation semantics:

- `all` succeeds only if every child item is satisfied.
- `any` succeeds if at least one child item is satisfied.
- `upgrade` succeeds if the referenced upgrade is owned.

Make sure the helper is deterministic and handles deeply nested expressions safely.

---

## Validation Rules

Validate prerequisite expressions at mode load time:

- non-empty `items` arrays for `all` and `any`
- no unknown `UpgradeId` references
- no self-referential cycles
- leaf nodes must be `upgrade` expressions

Cycle detection should traverse the graph of upgrade dependencies, treating `any` as a branch that may still participate in a cycle.

---

## UI Presentation

Display complex prerequisites clearly in the upgrade tree:

- render `AND` groups as `A + B`
- render `OR` groups as `A or B`
- use indentation, grouping, or tooltips for nested expressions
- show a locked state when requirements aren’t met

Example label:

- `Requires: (u1 and u2) or u3`

Use the same rendering logic in client and server diagnostics for consistency.

---

## Backward Compatibility

Support legacy arrays using automatic migration in the shared parser layer:

- `string[]` → `all` expression
- preserve exact semantics for existing upgrades

This avoids forcing mode definitions to be rewritten immediately.

---

## Server / Client Integration

- Both client and server should use the shared prerequisite evaluator.
- `canBuyUpgrade` should call `isPrerequisiteSatisfied(upgrade.prerequisites, state)`.
- Static validation should reject malformed prerequisite expressions before gameplay starts.

---

## Testing Strategy

Cover:

- `all` with multiple satisfied upgrades
- `any` with a single satisfied branch
- nested `all`/`any` combinations
- invalid expressions and malformed data
- cycle detection and rejected modes
- UI rendering of complex prerequisite structures
