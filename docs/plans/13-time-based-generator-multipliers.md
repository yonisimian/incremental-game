# Plan 13

## Time-Based Generator Multiplier

### Overview

Add a generator upgrade that increases all generator production based on the time elapsed since purchasing the upgrade.

### Behavior

- The upgrade applies one global multiplier to all generators.
- The multiplier increases linearly over time.
- The multiplier is capped to prevent runaway scaling.
- The timer starts when the upgrade is first purchased.
- No special UX for now (no progress bar or cap indicator).

### Parameters

- **Cost:** 200 (score currency)
- **Factor:** 1/60 (≈ +1.67% per second)
- **Cap:** 10×
- **Prerequisites:** none

### Formula

```text
multiplier = min(1 + factor × elapsedSeconds, cap)
           = min(1 + (1/60) × elapsedSeconds, 10)
```

At factor = 1/60, the multiplier reaches 10× after 540 seconds (9 minutes).
In a 35-second timed round it reaches ≈ 1.58× if bought immediately.

### Implementation Notes

- Use game time / simulation time instead of wall-clock time.
- Store the purchase timestamp in `state.meta` (e.g. `meta['time_mult_t0'] = gameSec`).
- Write `state.meta.gameSec = timeSec` each tick in the game loop so `dynamicModifier` can read it.
- Use the existing `dynamicModifier` hook on `UpgradeDefinition` to compute the multiplier from `state.meta`.
- Apply the multiplier globally to all generator production (stage: `'multiplicative'`, field: per-generator or `'global'`).
- The multiplier should remain deterministic for multiplayer simulations.

### Future Considerations

Possible future extensions:

- logarithmic scaling
- exponential scaling
- per-generator aging
- configurable caps
- multiple scaling modes
