# Engineering the Numbers — Balance Design Plan

## Problem Statement

Currently, mode definitions (upgrades, generators, costs, modifiers) are hand-tuned
by guessing values and checking results in the dev panel simulator. This works for a
6-upgrade, 4-generator mode like Idler, but won't scale to richer modes. We need a
systematic method that:

1. Starts from **desired player experience** (pacing, decision points)
2. **Derives** numbers from those constraints
3. **Validates** that multiple strategies produce different-but-viable paths
4. **Catches regressions** when a balance tweak breaks pacing elsewhere

---

## Core Concept: Target Envelope

Instead of a single target curve, define an **envelope** — a band of acceptable
score trajectories over time. Good balance means:

- At least N strategies land within the envelope at each checkpoint
- No single strategy dominates at every checkpoint (strategic diversity)
- No strategy falls so far behind that it feels unplayable

```text
Score
  │          ╱ ── fastest viable
  │        ╱
  │      ╱╱╱╱   ← envelope (acceptable range)
  │    ╱╱╱╱
  │  ╱╱╱╱
  │╱╱╱╱
  │╱╱ ── slowest acceptable
  └──────────────────── Time
```

---

## Design Layers

### Layer 1 — Pacing Skeleton

Define the experience before any numbers exist. Each phase has a **feel** and
a **time budget**. For a 35-second Idler round:

| Phase           | Time Window | Experience Goal                                |
| --------------- | ----------- | ---------------------------------------------- |
| 1. Discovery    | 0 – 5s      | Player sees income ticking, reads upgrades     |
| 2. First Choice | 5 – 12s     | First upgrade becomes affordable, player picks |
| 3. Acceleration | 12 – 22s    | Second wave of purchases, income visibly ramps |
| 4. Optimization | 22 – 30s    | Multiplicative upgrades / generators compound  |
| 5. Sprint       | 30 – 35s    | Final seconds, squeeze out score               |

The phase boundaries are soft — what matters is that the player **transitions**
between them within the window, not that they hit an exact second.

### Layer 2 — Score Checkpoints (Target Envelope)

Translate the pacing skeleton into numeric checkpoints. Each checkpoint defines a
`[minScore, maxScore]` range at a given time. Any strategy that falls within the
range is "viable."

```typescript
interface Checkpoint {
  /** Seconds into the round. */
  timeSec: number
  /** Minimum acceptable score for a "viable" strategy. */
  minScore: number
  /** Maximum expected score (strategies above this are outliers / exploits). */
  maxScore: number
  /** Human-readable label for the phase. */
  phase: string
}

interface TargetEnvelope {
  /** Game mode this envelope applies to. */
  mode: GameMode
  /** Goal type (different goals ⇒ different pacing). */
  goalType: 'timed' | 'target-score' | 'buy-upgrade'
  /** Ordered checkpoints. */
  checkpoints: Checkpoint[]
  /** Minimum number of strategies that must be viable at every checkpoint. */
  minViableStrategies: number
  /** Maximum allowed score gap between best and worst viable strategy (ratio). */
  maxSpreadRatio: number
}
```

Example envelope for Idler timed mode (35s):

```typescript
const IDLER_TIMED_ENVELOPE: TargetEnvelope = {
  mode: 'idler',
  goalType: 'timed',
  checkpoints: [
    { timeSec: 5, minScore: 3, maxScore: 8, phase: 'Discovery' },
    { timeSec: 10, minScore: 15, maxScore: 40, phase: 'First Choice' },
    { timeSec: 15, minScore: 40, maxScore: 100, phase: 'Acceleration' },
    { timeSec: 25, minScore: 120, maxScore: 350, phase: 'Optimization' },
    { timeSec: 35, minScore: 250, maxScore: 600, phase: 'Sprint (final)' },
  ],
  minViableStrategies: 3,
  maxSpreadRatio: 2.5,
}
```

### Layer 3 — Deriving Numbers from the Envelope

Given a target envelope, work backwards to compute upgrade parameters:

**Step 1: Base income sets Phase 1.** With native modifiers of +1 r0/sec,
score at t=5 is ~5. This anchors the bottom of the envelope.

**Step 2: First upgrade cost ≈ income × phase-1-duration.** If the player
earns ~1/sec and should buy their first upgrade at ~5-8s, the cost should be
~5-8 r0. Currently Heavy Logging costs 25 r0, which means first purchase at
~25s — this is Phase 3 territory, not Phase 2. (This is exactly the kind of
insight the envelope gives you.)

**Step 3: Upgrade effect = (next-phase-income - current-income).** If Phase 2
should produce ~4/sec (to reach ~40 score by t=10), and base is 1/sec, the
first upgrade should add ~+3/sec.

**Step 4: Multiplicative upgrades constrain max score.** A ×1.25 multiplier on
~8/sec additive gives 10/sec. Time this so it becomes affordable in Phase 4.

**Step 5: Generator costs follow a geometric series.** With costScaling=1.15,
the Nth generator costs `baseCost × 1.15^N`. The player should be able to buy
2-3 generators in Phase 3 (each one should feel meaningful but not trivially
affordable).

### Layer 4 — Diversity Constraints

To ensure multiple viable strategies:

- **Orthogonal upgrade pairs**: Two upgrades that boost different resources at
  similar costs create a branch point. The player picks one first, the other
  second — both paths are valid.
- **Early vs. late power tradeoffs**: A cheap +3/sec upgrade is better early; an
  expensive ×2 upgrade is better late. Both should be viable.
- **Generator vs. upgrade tradeoff**: Buying 3 cheap generators might give +0.6/sec
  (comparable to a single +5/sec upgrade but at a lower total cost, spread over
  time). This creates a "many small vs. one big" decision.
- **Resource cross-dependencies**: Idler already has this — ale-costing upgrades
  that boost wood. This forces the player to balance two economies.

---

## Implementation Plan

### Phase A — Envelope Definition & Validation (dev panel)

**Goal:** Add a `TargetEnvelope` type and a validation function that checks
simulation results against it. Show results in the dev panel.

1. **Define `TargetEnvelope` type** in `shared/src/types.ts` or a new
   `shared/src/balance/` module.

2. **Define envelopes per mode** alongside the mode definition (e.g.
   `shared/src/modes/idler-envelope.ts`).

3. **Add `validateEnvelope()` function:**

   ```typescript
   function validateEnvelope(envelope: TargetEnvelope, results: SimResult[]): EnvelopeReport {
     // For each checkpoint:
     //   - Find the score of each strategy at that timeSec
     //   - Count how many fall within [minScore, maxScore]
     //   - Check spread ratio between best and worst viable
     // Return per-checkpoint pass/fail + overall verdict
   }
   ```

4. **Show envelope in the dev panel:**
   - Overlay the envelope band on the score chart (shaded region)
   - Add an "Envelope Report" section showing pass/fail per checkpoint
   - Color-code strategies: green (within envelope), yellow (close), red (outside)

5. **Add envelope validation to CI** (optional, later):
   - Run all strategies through the simulator
   - Assert envelope passes
   - Fail the build if a mode change breaks pacing

### Phase B — Reverse Engineering Tool (dev panel)

**Goal:** Given a target envelope, suggest upgrade parameters.

1. **Add a "Derive" mode** to the dev panel that takes an envelope and
   computes suggested costs/effects:
   - Input: target score at each checkpoint, number of upgrades per phase
   - Output: suggested cost and effect for each upgrade
   - Algorithm: simple algebra from the rate equations

2. **Constraint solver** (stretch goal): Given N upgrade slots and an
   envelope, find costs/effects that maximize strategy diversity while keeping
   all paths within bounds. This is an optimization problem — even a brute-force
   grid search over a small parameter space would be useful.

### Phase C — Balance Dashboard

**Goal:** A permanent view in the dev panel showing the health of all modes.

- Mode selector → runs all strategies → shows envelope report
- Red/yellow/green status per checkpoint
- "Strategy diversity index" — a single number showing how spread out the
  viable strategies are (higher = more diverse = better)
- Historical tracking (optional): store envelope results over time to see
  if balance is improving or regressing

---

## Analysis of Current Idler Balance

Running the existing strategies against a hypothetical envelope reveals issues:

### Income Curve (base only, no purchases)

- Base: +1 r0/sec → at t=35, score = 35 (without any highlight bonuses)
- With highlight ×2: ~2/sec on r0 → score ≈ 70

### Cheapest Upgrade Timing

- Generators g0/g1: cost 10 → affordable at ~10s ✓ (reasonable for Phase 2)
- Heavy Logging (u1): cost 25 r0 → affordable at ~13-25s depending on path
- Sharpened Axes (u0): cost 30 r0 → affordable at ~15-30s
- Royal Brewery (u2): cost 25 r1 → affordable at ~13-25s (from ale income)
- These cluster too closely — there's no clear "first purchase" moment

### Upgrade Power

- Heavy Logging: +5/sec is a 5× multiplier over base 1/sec — very strong
- Generators: +0.2/sec is a 0.2× multiplier over base — very weak by comparison
- This means generators are almost never worth buying for wood (you'd need 25
  generators to match Heavy Logging, costing ~10+11+13+15+... ≈ 400 r0 total)

### Observations

1. **Generators are too weak relative to upgrades.** A single +5/sec upgrade
   outclasses 10 generators. Fix: increase generator base rate, or decrease
   upgrade effect, or both.
2. **First meaningful purchase is too late.** At ~10-25s into a 35s round,
   Phase 2 doesn't start until the round is 30-70% over. Fix: lower first
   upgrade cost, or increase base income.
3. **Industrial Era (×1.25) is gated behind 3 prerequisites** (u0, u1, u2 =
   30+25+25 = 80 resources minimum). In a 35s round with ~2/sec average income,
   that's 40s of pure income — literally impossible to reach without generators
   or Master Craftsmen. This upgrade exists only for longer goal types.
4. **Master Craftsmen (u3, repeatable +5 r0/sec, costs 10 r1)** is extremely
   efficient — 10 ale for +5 wood/sec. Three purchases (30 ale) give +15/sec.
   This might be intentionally strong as a "combo" reward for investing in ale
   first.

---

## Suggested Next Steps

1. **Start with Phase A** — define the envelope, add validation, overlay on charts.
   This gives immediate value with minimal code.
2. **Use the validation to identify current balance issues** — the analysis above
   is manual; automating it makes it repeatable.
3. **Iterate on Idler numbers** using the envelope as a guide — adjust costs and
   effects until the envelope passes with ≥3 diverse strategies.
4. **Apply the same framework** when building the next mode — start from the
   pacing skeleton, not from the upgrades.
