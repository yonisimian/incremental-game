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

- At least N strategies land within the envelope at the final checkpoint
- No single strategy dominates at every checkpoint (strategic diversity)
- Many paths may be weak or non-viable — that's fine, as long as enough good
  ones exist

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
`[minScore, maxScore]` range at a given time. Any strategy whose **cumulative
score** (total score-resource ever produced) falls within the range is "viable."

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
  /**
   * Minimum number of strategies that must be viable at the **final** checkpoint.
   * (Earlier checkpoints are informational — a slow-start strategy that catches
   * up by the end is still considered viable.)
   */
  minViableStrategies: number
  /** Maximum allowed ratio between best and worst *viable* strategy scores at the final checkpoint. */
  maxStrategySpread: number
}
```

Example envelope for Idler timed mode (`IDLER_ROUND_DURATION_SEC = 35`):

> **Note:** The numeric values below are **placeholders (TBD)**. The correct
> workflow to derive real values is:
>
> 1. Run all 13 existing strategies through the simulator.
> 2. Use P10/P90 of cumulative scores at each timestamp as initial bounds.
> 3. Tighten or shift the bounds to match the desired pacing feel.
> 4. Re-validate — at least `minViableStrategies` must still land within bounds.
>
> Do NOT treat these numbers as targets until they've been calibrated against
> actual sim output.

```typescript
const IDLER_TIMED_ENVELOPE: TargetEnvelope = {
  mode: 'idler',
  goalType: 'timed',
  checkpoints: [
    // TBD — derive from sim P10/P90 once Phase A is implemented
    { timeSec: 5, minScore: 3, maxScore: 8, phase: 'Discovery' },
    { timeSec: 10, minScore: 15, maxScore: 40, phase: 'First Choice' },
    { timeSec: 15, minScore: 40, maxScore: 100, phase: 'Acceleration' },
    { timeSec: 25, minScore: 120, maxScore: 350, phase: 'Optimization' },
    { timeSec: 35, minScore: 250, maxScore: 600, phase: 'Sprint (final)' },
  ],
  minViableStrategies: 3,
  maxStrategySpread: 1.15,
}
```

> **Checkpoint placement:** Checkpoints don't need to align 1:1 with phase
> boundaries. Place them at moments where you have a clear expectation of
> where score _should_ be. The pacing skeleton (Layer 1) is the design intent;
> checkpoints are derived measurement points that sample the trajectory at
> key moments.

> **For non-timed goal types:** The checkpoint model inverts. For `target-score`
> goals, the score axis is fixed (the target) and the variable is time-to-reach.
> Define checkpoints as `{ scoreThreshold, minTimeSec, maxTimeSec }` instead.
> For `buy-upgrade` goals, use the same time-based model but the "score" is
> progress toward affording the trophy upgrade.

### Layer 3 — Deriving Numbers from the Envelope

Given a target envelope, work backwards to compute upgrade parameters:

**Step 1: Base income sets Phase 1.** With highlight ×2 on the score resource,
income is ~2/sec. At t=5, cumulative score ≈ 10. This gives a rough anchor for
the Discovery phase — the actual checkpoint bounds should be derived from sim
data, not from this back-of-envelope math.

**Step 2: First upgrade cost ≈ income × phase-1-duration.** If the player
earns ~2/sec (highlighted) and should buy their first upgrade at ~5-10s, the
cost should be ~10-20 r0. Currently generators cost 10 r0 (first buy at ~5s)
and Heavy Logging costs 25 r0 (first buy at ~13s). Both land in the Phase 2
window.

**Step 3: Upgrade effect = (next-phase-income - current-income).** If Phase 3
should produce ~6-8/sec (to reach ~100 score by t=15), and Phase 2 income is
~2-4/sec, upgrades purchased in Phase 2 should collectively add ~+3-5/sec.

**Step 4: Multiplicative upgrades constrain max score.** Industrial Era (×1.25)
on ~8/sec additive gives 10/sec. Time this so it becomes affordable in Phase 4.
Its prerequisite chain (u0+u1+u2) acts as a natural gate.

**Step 5: Generator costs follow a geometric series.** With costScaling=1.15,
the Nth generator costs `baseCost × 1.15^N`. The player should be able to buy
2-3 generators in Phase 2-3 (each one should feel meaningful but not trivially
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

**Measuring diversity:** Two strategies are considered **orthogonal** if they
share ≤50% of their purchase sequence (by action count). The "strategy diversity
index" is the percentage of strategy pairs that are orthogonal. Target: ≥40% of
pairs should be orthogonal, ensuring the mode isn't solved by a single path.

### Layer 5 — Player-Skill Variance (Highlight Mechanic)

The highlight mechanic is a ×2–×4 manual toggle that players switch between
resources. Unlike upgrades (which the sim models deterministically), highlight
timing depends on player skill:

- **Perfect play:** Switch highlight the instant a purchase is complete (0s delay)
- **Average play:** ~1-2s delay per switch (reading board, deciding)
- **Novice play:** 3-5s delay, or suboptimal highlight choices

The envelope must accommodate this variance. Strategies in the simulator assume
perfect highlight timing — real players will score **10-20% below** sim results.

**Validation approach:** Rather than applying an arbitrary discount factor to
checkpoint values, model skill variance directly by running each strategy in
two modes:

1. **Perfect timing** — highlight switches instantly (what the sim does today)
2. **Delayed timing** — add a 2s delay before each `set_highlight` action

A strategy is considered **viable** only if _both_ variants land within
`[minScore, maxScore]` at the final checkpoint. This models real player behavior
concretely rather than guessing a flat penalty multiplier.

> **Implication for envelope design:** Since delayed-timing scores will be
> 10-20% lower, set `minScore` values low enough that good strategies still
> pass in delayed mode. The workflow (run sims → use P10/P90 → set bounds)
> should include both timing variants in the initial data collection.

### Layer 6 — Violation Classification

When a strategy falls outside the envelope:

| Position         | Classification    | Action                                                    |
| ---------------- | ----------------- | --------------------------------------------------------- |
| Above `maxScore` | Potential exploit | Nerf candidate — investigate which purchase is over-tuned |
| Below `minScore` | Non-viable        | Buff candidate, OR accept as a "niche/challenge" path     |
| Within band      | Viable            | No action needed                                          |

**CI behavior:** Envelope validation should **fail the build** if fewer than
`minViableStrategies` land within the band at the final checkpoint, or if
`maxStrategySpread` is exceeded. Strategies above `maxScore` at any checkpoint
produce a **warning annotation** on the PR (not a hard failure) since they may
indicate intentional high-risk paths.

---

## Implementation Plan

### Phase A — Envelope Definition & Validation (dev panel)

**Goal:** Add a `TargetEnvelope` type and a validation function that checks
simulation results against it. Show results in the dev panel.

1. **Define `TargetEnvelope` type** in a new `shared/src/balance/` module.

2. **Define envelopes per mode** alongside the mode definition (e.g.
   `shared/src/modes/idler-envelope.ts`).

3. **Add `validateEnvelope()` function:**

   ```typescript
   function validateEnvelope(envelope: TargetEnvelope, results: SimResult[]): EnvelopeReport {
     // For each checkpoint:
     //   - Find the score of each strategy at that timeSec (both timing variants)
     //   - Classify each strategy as within/above/below the band
     // At the final checkpoint:
     //   - A strategy is "viable" if BOTH its perfect and delayed variants
     //     fall within [minScore, maxScore]
     //   - Verify ≥ minViableStrategies are viable
     //   - Check spread ratio between best and worst viable
     // Return per-checkpoint status + overall pass/fail verdict
   }
   ```

4. **Show envelope in the dev panel:**
   - Overlay the envelope band on the score chart (shaded region)
   - Add an "Envelope Report" section showing pass/fail per checkpoint
   - Color-code strategies: green (within envelope), yellow (close), red (outside)

### Phase A.5 — Tune Idler Numbers (manual iteration)

**Goal:** Validate the envelope concept by manually fixing the issues identified
in the analysis section below. No new tooling — just adjust mode constants and
re-run the simulator until the envelope passes.

1. Fix generator base rates (too weak relative to upgrades)
2. Lower first-upgrade costs to hit Phase 2 timing
3. Verify ≥3 strategies land within the envelope
4. Verify `maxStrategySpread ≤ 1.15` at the final checkpoint

This phase proves the envelope is useful _before_ investing in automation.

> **Current state:** Idler does NOT pass `minViableStrategies: 3` today. Only
> 2 strategies (All-In, SA-first) score within 15% of best. Fixing this is the
> explicit goal of Phase A.5.

### Phase B — Parameter Sweep Tool (dev panel)

**Goal:** Given a target envelope, explore the parameter space to find balanced
upgrade configurations.

> **Why not algebra?** With compounding purchases, dynamic modifiers, and the
> highlight mechanic, closed-form solutions don't exist. The right approach is
> empirical search.

1. **Parameter sweep mode** in the dev panel:
   - Define ranges for each tunable parameter (e.g. `u1.cost ∈ [10, 50]`,
     `u1.effect ∈ [2, 8]`)
   - Run the full strategy suite for each parameter combination
   - Score each combination by envelope fitness (how many strategies are viable,
     what's the spread)
   - Display the Pareto frontier: configurations that maximize diversity without
     violating the envelope

2. **Grid search** (practical first step): Even a coarse 5-step grid over 3
   parameters (125 combinations × 13 strategies = 1,625 sim runs) should be
   fast enough for interactive use. Benchmark once implemented — if it's slow,
   reduce grid resolution or parallelize with workers.

3. **Refinement** (stretch): Narrow the grid around promising regions, or use
   simple hill-climbing on the diversity metric.

### Phase C — CI Integration

**Goal:** Prevent balance regressions from landing unnoticed.

1. **Extract simulation engine** from `client/src/dev/simulate.ts` into
   `shared/src/simulation/` — it already uses only shared types and pure
   functions. This makes it importable from a CI script without bundling the
   client.

   > **Scope note:** The `simulate()` function (engine) is generic and belongs
   > in shared. The _strategies_ (`IDLER_STRATEGIES`) are mode-specific test
   > fixtures — they stay alongside the mode definition or in a test directory
   > (e.g. `shared/src/modes/idler-strategies.ts` or `shared/tests/`).

2. **CI script** (`scripts/check-balance.ts`):
   - Import mode definitions, strategies, and envelopes
   - Run all strategies through the simulator
   - Validate against the envelope
   - Exit non-zero if `minViableStrategies` is violated or spread exceeds limit
   - Print a summary table (strategy → final score → within/outside)

3. **Envelope definitions live in `shared/src/modes/`** alongside the mode
   definitions they constrain (e.g. `idler-envelope.ts` next to `idler.ts`).

4. **Failure mode:** Hard fail if fewer than N strategies are viable. Warning
   annotation if a strategy exceeds `maxScore` (potential exploit).

### Phase D — Balance Dashboard (deferred)

**Goal:** A permanent view in the dev panel showing the health of all modes.
Defer until there are ≥2 modes to compare.

- Mode selector → runs all strategies → shows envelope report
- Red/yellow/green status per checkpoint
- "Strategy diversity index" — percentage of orthogonal strategy pairs
- Historical tracking via git-tracked snapshots
  (`docs/balance-snapshots/idler-timed.json`) updated by CI on main

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
3. **Industrial Era (×1.25) is gated behind 3 prerequisites** (u0=30 wood,
   u1=25 wood, u2=25 ale → 55 wood + 25 ale for prereqs, plus 50 wood for IE
   itself = **105 wood + 25 ale total**). In a 35s round, even with highlight
   switching, the combined farming time makes IE unreachable in timed mode
   without generators or Master Craftsmen. This upgrade exists only for longer
   goal types.
4. **Master Craftsmen (u3, repeatable +5 r0/sec, costs 10 r1)** is extremely
   efficient — 10 ale for +5 wood/sec. Three purchases (30 ale) give +15/sec.
   This might be intentionally strong as a "combo" reward for investing in ale
   first.

---

## Suggested Next Steps

1. **Phase A** — Define the envelope type, add `validateEnvelope()`, overlay on
   the dev panel score chart. Immediate value with minimal code.
2. **Phase A.5** — Manually tune Idler numbers using the envelope as a guide.
   Fix the 4 issues from the analysis above. Validate with ≥3 diverse strategies.
3. **Phase C** — Extract simulation into `shared/`, add `scripts/check-balance.ts`
   to CI. Prevents future regressions.
4. **Phase B** — Only when adding a new mode. For Idler, manual tuning +
   sim verification is sufficient; a parameter sweep tool pays off when there
   are more parameters than you can explore by hand.
5. **Phase D** — Defer the dashboard until there are ≥2 modes to compare.

---

## New Mode Checklist

When adding a new mode, follow this workflow to ensure it ships balanced:

1. **Pacing skeleton** — Define phases and time windows (Layer 1).
2. **Write ≥3 strategies** — Manually author at least 3 distinct strategies
   covering different playstyles (e.g. rush, balanced, economy-first).
3. **First sim run** — Run all strategies, use P10/P90 as initial envelope.
4. **Tune constants** — Iterate on costs/effects until the envelope passes
   (`minViableStrategies` within band, `maxStrategySpread` satisfied).
5. **Add envelope to CI** — Register the mode's envelope in
   `scripts/check-balance.ts` so regressions are caught automatically.
6. **Add to dashboard** (when Phase D exists) — Register mode in the
   balance dashboard for ongoing visibility.
