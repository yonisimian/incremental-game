# Generator Meta Upgrade Plan

## Overview

Add two new Idler upgrades that grant generator modifiers based on generator ownership patterns.

### Upgrade 1: Dominant Harvesters

- Type: generator meta upgrade
- Effect: apply a ×2 multiplier to exactly one generator.
- Mechanic:
  1. Select the generator with the highest owned count.
  2. If multiple generators are tied for highest count, choose the lower-tier generator as the tiebreaker.
- Example:
  - counts `{ g0: 3, g1: 3, g2: 1, g3: 0 }` → `g0` wins because it is lower tier than `g1`.
  - counts `{ g0: 2, g1: 4, g2: 4, g3: 4 }` → `g1` wins because it is the lowest-tier generator among the top tie.
- Benefit: gives a deterministic champion generator bonus and prevents multiple tied generators from sharing the same multiplier.

### Upgrade 2: Balanced Engineering

- Type: generator meta upgrade
- Effect: apply one global multiplier based on how balanced all owned generator counts are.
- Mechanic:
  1. Calculate the average generator count across all generators, including zeros.
  2. Compute each generator's deviation from that average.
  3. Derive a normalized balance ratio from the aggregate deviation.
  4. Apply a single global multiplier to production using that balance ratio.
- Example formula:
  - `avg = (g0 + g1 + g2 + g3) / 4`
  - `deviation = (|g0 - avg| + |g1 - avg| + |g2 - avg| + |g3 - avg|) / 4`
  - `balanceRatio = max(0, 1 - deviation / avg)` when `avg > 0`
  - `globalBonus = 1 + balanceRatio * 0.25`
- Interpretation:
  - Balanced ownership (counts close to average) produces a ratio near 1 and gives the maximum bonus.
  - Heavily specialized ownership (one very high count and others low) produces a larger deviation, lowering the ratio and the bonus.
- Benefit: rewards investments that keep generator counts close together rather than heavily concentrating on a single line.

## Implementation notes

- Add new upgrade metadata in `shared/src/modes/idler.ts` with flavor names and descriptions.
- Implement `Dominant Harvesters` as a deterministic single-generator multiplier selection in the modifier collection logic.
- Implement `Balanced Engineering` as a single global modifier derived from the generator balance ratio.
- Add regression tests in `shared/tests/modes.test.ts` verifying both upgrade effects.
- Update client UI tests only if the new upgrades change the idler tree layout.
