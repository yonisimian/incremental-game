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
- `applyPassiveTick` accumulates `state.meta.gameSec` each tick.
- `applyPurchase` auto-records `state.meta.purchasedAt[upgradeId] = gameSec` on first buy.
- `dynamicModifier` reads elapsed time from `state.meta.purchasedAt.u12` and `state.meta.gameSec`.
- Apply the multiplier globally to all generator production (stage: `'multiplicative'`, field: `'globalMultiplier'`).
- The multiplier remains deterministic for multiplayer simulations.

### Status: superseded

The original `u12` was wiped with the rest of the PoC tree (Phase 0), and the
mechanic is now data-driven — see `shared/src/time-bonus.ts` and the
`timeScaledModifier` / `timeFactorBoost` / `timeRetroactive` effects, wired to the
idler's `ae-mf-ar-time` → `ae-atf` → `ae-tf-retro` branch. Two notes on the
differences: the purchase timeline is `meta.purchaseTimes` (an array per upgrade,
so a repeatable boost's levels can be dated individually), and there is no
`globalMultiplier` field any more (removed in plan 27) — a clock targets each
resource's rate, one effect ref per resource.

### Future Considerations

Possible future extensions:

- logarithmic scaling
- exponential scaling
- per-generator aging
- configurable caps
- multiple scaling modes
