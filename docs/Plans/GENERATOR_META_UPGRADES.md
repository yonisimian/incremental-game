# Generator Meta Upgrade Plan

## Overview

Add two new Idler upgrades that grant generator-targeted multipliers based on the current generator counts.

### Upgrade 1: Dominant Harvesters

- Type: generator meta upgrade
- Effect: apply a ×2 multiplier to the generator(s) with the highest owned count.
- Mechanic: compute the maximum count among all generators. Every generator whose count equals that maximum receives the multiplier.
- Benefit: rewards players who invest heavily in a single strongest production line, making the biggest generator line even more powerful.

### Upgrade 2: Balanced Engineering

- Type: generator meta upgrade
- Effect: apply a bonus multiplier to each generator based on how close its count is to the most-owned generator.
- Mechanic: for each generator with count > 0, calculate `difference = maxCount - count`. The smaller the difference, the larger the multiplier.
- Example formula: `bonus = 1 + (1 - difference / maxCount) * 0.25` when `maxCount > 0`.
  - If a generator count is equal to the max count, it gets the full bonus.
  - If a generator is much smaller, it gets a smaller bonus.
- Benefit: encourages players to keep generator counts balanced and rewards lines that are close to the top build.

## Implementation notes

- Add new upgrade metadata in `shared/src/modes/idler.ts` with flavor names and descriptions.
- Use a dynamic modifier collection hook such as `collectIdlerDynamic` or generator-targeted modifier logic in `collectModifiers`.
- The first upgrade should target generator output by selecting top-count generators.
- The second upgrade should compute per-generator bonuses from relative count difference.
- Add regression tests in `shared/tests/modes.test.ts` verifying both effects.
- If needed, update client UI tests only if new upgrade placement changes the idler tree layout.
