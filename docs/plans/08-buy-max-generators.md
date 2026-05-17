# PLAN: Buy Max Generators

## Status: Draft

---

## Problem Statement

Generator purchase is currently one copy at a time. This becomes tedious for players once generators are inexpensive or when scaled generator systems are present.

Bulk purchase is a standard incremental-game UX improvement and also simplifies generator investment pacing.

---

## Goals

- Add a first-class "Buy Max" action for generators.
- Preserve existing geometric generator cost behavior.
- Keep client/server purchase validation deterministic.
- Enable buy-max for all generators by default.
- Minimize runtime overhead.

---

## Proposal

Add a shared generator purchase helper that computes:

- the cost to buy `N` additional copies from current count
- the maximum quantity affordable assuming current resources
- a purchase action that can apply the bulk buy atomically

Keep generator definitions unchanged.

---

## Bulk Purchase Calculation

For geometric-cost generators, use the closed-form cost sum when possible:

- `cost(n) = baseCost * scaling^n`
- `totalCost(k) = baseCost * (r^current * (r^quantity - 1) / (r - 1))`

If cost is linear or piecewise, fall back to a deterministic loop.

Key requirements:

- quantity must never exceed the number of copies the player can afford
- the calculation must match server validation exactly
- bulk purchase should return the actual quantity purchased and cost spent

---

## Affordability Calculation

Shared UI/server helper should determine maximum affordable quantity.

Strategy:

1. Compute cost for one next copy.
2. Use closed-form inverse formulas where available.
3. Fall back to stepping if scaling is irregular.
4. Clamp by generator limits if any.

Avoid naively iterating one copy at a time in hot paths unless the quantity is small.

---

## UI Integration

Add a dedicated button or secondary action near each generator:

- `Buy Max` button on generator cards
- Show total cost and quantity when hovered or focused
- Disable if no copies are affordable

Display both:

- next copy cost
- max affordable copies

---

## Multiplayer / Server Validation

Server and client must share the same bulk cost helper.

Validation rules:

- reject purchases if resource balance is insufficient
- reject if quantity is 0
- verify generator definition exists and supports bulk purchase

Prefer a single shared function used by both server and client to avoid divergent behavior.

---

## Performance Considerations

- Use closed-form formulas for geometric cost when possible.
- Avoid repeated expensive math inside UI render loops.
- Memoize affordability for the currently hovered generator if the UI updates frequently.
- Keep the generator purchase helper O(1) for typical generator definitions.

---

## Testing Strategy

Unit tests should cover:

- cost sum for geometric scaling
- maximum affordable copies calculation
- server validation for valid and invalid bulk buys
- UI state for affordable and unaffordable buy-max cases

Integration tests should verify:

- `Buy Max` spends the expected amount
- `Buy Max` purchases the expected quantity
- no partial state changes occur on invalid purchase attempts
