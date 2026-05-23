## Time-Based Generator Multiplier

### Overview

Add a generator upgrade that increases all generator production based on the time elapsed since purchasing the upgrade.

### Behavior

- The upgrade applies one global multiplier to all generators.
- The multiplier increases linearly over time.
- The multiplier is capped to prevent runaway scaling.
- The timer starts when the upgrade is first purchased.

### Formula

:contentReference[oaicite:0]{index=0}

Where:

- `factor` is the scaling rate per second.
- `elapsedSeconds` is the number of game seconds since purchasing the upgrade.
- `10` is the current temporary cap.

### Implementation Notes

- Use game time / simulation time instead of wall-clock time.
- Store the purchase timestamp/tick when the upgrade is first bought.
- Recalculate the multiplier dynamically during modifier collection.
- Apply the multiplier globally to all generator production.
- The multiplier should remain deterministic for multiplayer simulations.

### Future Considerations

Possible future extensions:

- logarithmic scaling
- exponential scaling
- per-generator aging
- configurable caps
- multiple scaling modes
