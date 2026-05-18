# PLAN: Lower-Tier Support Generator Synergies

## Status: Draft

---

## Problem Statement

Generator progression is currently isolated by tier. Many incremental designs use lower-tier generators to support higher-tier output, creating a sense of layered progression.

Examples:

- tier 1 generators boost tier 2 output
- support structures increase the efficiency of later tiers
- lower-tier investments influence endgame scaling

---

## Goals

- Support explicit synergies between generators.
- Keep synergy definitions declarative and easy to author.
- Apply support bonuses in modifier collection.
- Display synergy relationships in the UI.

---

## Definition Proposal

Add optional synergy metadata to generator definitions:

```ts
export interface GeneratorSynergy {
  readonly sourceGeneratorId: GeneratorId
  readonly targetGeneratorId: GeneratorId
  readonly multiplierPerSource: number
  readonly capMultiplier?: number
}
```

This can also be expressed as a list on the source or target:

- `sourceGenerator.synergies` or `targetGenerator.supportFrom`

Semantics:

- each owned source generator contributes a bonus to the target
- support may scale additively or multiplicatively depending on the modifier
- optional `capMultiplier` prevents runaway scaling

---

## Modifier Integration

During modifier collection, compute synergy effects based on current counts:

- read `ownedSourceCount`
- compute `supportBonus = ownedSourceCount * multiplierPerSource`
- apply `supportBonus` to target generator output or resource production

If multiple synergies affect the same target, stack them according to existing modifier rules.

---

## UI Behavior

Display recognized synergies in generator cards:

- `+5% tier 2 output per tier 1 generator`
- show current effective bonus when source generator is owned
- optionally show inactive synergies when source count is zero

In the generator tree, use a tooltip or line item for each synergy.

---

## Validation Rules

Shared mode validation should ensure:

- both source and target generator IDs exist
- `multiplierPerSource` is numeric and non-negative
- `capMultiplier`, when present, is >= 1

Reject invalid synergy definitions early.

---

## Extensibility

Future support can include:

- threshold-based bonuses: apply only after `N` sources are owned
- support from multiple lower tiers to a shared target
- ratio-based output transfer instead of flat multiplier

Start with the simple linear support case.

---

## Testing Strategy

Cover:

- source generator count producing the expected bonus
- cap enforcement when `capMultiplier` is set
- multiple synergies stacking on one target
- UI text reflecting active and inactive support
