# PLAN: Time-Based Generator Multipliers

## Status: Draft

---

## Problem Statement

A new upgrade should grant a global generator multiplier that grows as time passes.

This enables a progression mechanic where owning the upgrade makes all generators stronger over time, rather than boosting only one tier or relying on static modifiers.

---

## Goals

- Implement an upgrade that applies a time-scaled multiplicative bonus to all generators.
- Keep the effect deterministic and authoritative on the server.
- Avoid per-generator aging state; track the time source at the upgrade level.
- Present the current multiplier clearly in the UI.

---

## Definition Proposal

Introduce an upgrade modifier type for time-based scaling:

```ts
export interface TimeScaledGeneratorUpgrade {
  readonly type: 'time-scaled-generator-multiplier'
  readonly factor: number
  readonly maxMultiplier?: number
}

export interface UpgradeDefinition {
  readonly id: UpgradeId
  readonly maxLevel: number
  readonly modifiers: readonly Modifier[]
  readonly timeScaledGenerator?: TimeScaledGeneratorUpgrade
  // ...
}
```

Semantics:

- owning the upgrade enables a single global multiplier for all generators
- `factor` is interpreted by the upgrade type
  - for linear scaling: `1 + factor * elapsedSeconds`
  - for exponential scaling: `factor^elapsedSeconds`
- `maxMultiplier` caps the effect if provided

---

## State Design

Track upgrade activation time once when the upgrade is bought:

- `state.upgradeTimestamps[upgradeId]`

If the upgrade can be bought multiple times, use the first purchase timestamp for scaling.
Otherwise, preserve the timestamp of the current owned upgrade effect.

The server owns the authoritative timestamp to prevent client-side time tampering.

---

## Modifier Calculation

When the upgrade is active, compute the global generator multiplier from elapsed time:

- `elapsedSec = serverTime - state.upgradeTimestamps[upgradeId]`
- `multiplier = computeTimeScaledMultiplier(def.timeScaledGenerator, elapsedSec)`
- apply `multiplier` to every generator output modifier or directly to generator production

Keep the multiplier computation pure and shared between client and server.

---

## UI Presentation

Display the active upgrade and its current effect:

- summary line: `Generator power increases over time`
- current multiplier: `x1.25 uptime bonus`
- tooltip: `Every second, generator output ramps up based on upgrade progress.`

If a cap exists, show it as `Capped at xN`.

---

## Validation and Server Sync

The server should:

- serialize the upgrade purchase timestamp in round state
- compute elapsed time from its own clock
- reject any client action that relies on stale or manipulated time data

Client UI may estimate the multiplier locally, but authoritative game state comes from the server.

---

## Edge Cases

- if the upgrade is not owned, the multiplier remains `x1`
- if the upgrade is purchased mid-round, scaling starts from the purchase time
- if the effect is capped, it should stop increasing once the maximum is reached
- if the upgrade is refunded or removed, the timestamp should be cleared

---

## Testing Strategy

Unit tests should cover:

- multiplier growth from the purchase timestamp
- cap enforcement when `maxMultiplier` is present
- pure computation for linear and exponential factor interpretation
- UI display of current uptime multiplier
