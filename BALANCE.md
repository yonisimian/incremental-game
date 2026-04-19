# Balance Reference Book

A living document on how to **engineer fun** through numbers. Covers the principles, formulas, and lessons learned while balancing the incremental game.

> _"Game balance is not about making everything equal — it's about making every choice interesting."_

---

## Table of Contents

1. [Core Concept: Payback Period](#1-core-concept-payback-period)
2. [The Five Design Levers](#2-the-five-design-levers)
3. [Setting Constants: The Framework](#3-setting-constants-the-framework)
4. [Idler Mode Analysis](#4-idler-mode-analysis)
5. [Lessons Learned](#5-lessons-learned)

---

## 1. Core Concept: Payback Period

In an incremental game, every upgrade is an **investment**: you spend accumulated resources now to increase your production rate for the rest of the round. The central question is: _"Will this upgrade earn back more than it cost before time runs out?"_

The **payback period** of an upgrade is the time it takes to recoup its cost:

```
payback_period = cost / benefit_increase_per_second
```

- If an upgrade can't pay for itself before the round ends, it's a **trap** — the player is punished for buying it.
- If _every_ upgrade pays for itself trivially fast, there are **no decisions** — the player just buys whatever becomes available.
- The sweet spot: upgrades that require deliberate timing to be profitable.

**Caveat: not all upgrades are additive rate boosts.** The payback formula cleanly applies to upgrades that add a fixed amount per second ($+N$/s). Two other upgrade types need different analysis:

- **Multipliers** (e.g., Sharpened Axes: highlight boost 2× → 4×). The benefit depends on the current base rate _and_ game state (which currency is highlighted). Payback period varies — compute it at the specific game state where the upgrade will be purchased.
- **One-time conversions** (e.g., Liquid Courage: convert all ale → wood). There is no ongoing `benefit_per_sec`, so the payback formula doesn't apply. Instead, evaluate the **conversion value** at the intended purchase time: how much ale will the player have, and is that converted amount worth the cost + opportunity cost of farming the ale?

### Upgrade Chain Traces

The payback formula above treats production rate as constant. In practice, each upgrade _changes_ the rate at which you farm the next one. This compounding effect is the heart of incremental games, and the right way to analyze it is by **tracing the full upgrade chain** with evolving rates:

```
 0– 5s   Highlight ale → accumulate 10🍺, 5🪵     (rates: 1🪵/s, 2🍺/s)
    5s   Buy Tavern Recruits (10🍺) → base wood = 2
 5–14s   Highlight wood → 4/s → ~41🪵 total        (rates: 4🪵/s, 1🍺/s)
   14s   Buy Sharpened Axes (40🪵) → highlight = 4×
14–29s   Highlight wood → 8/s → ~121🪵 total        (rates: 8🪵/s, 1🍺/s)
   29s   Buy Lumber Mill (120🪵) → ~1🪵 left, rate = 16/s
29–60s   31s at 16/s → ~496🪵                       Final score ≈ 657
```

_(In real play, human latency between earning enough and clicking buy costs ~2–3s of production per upgrade, bringing the actual score closer to ~613.)_

A naïve static analysis (using only the base 2🪵/s) would say Lumber Mill (120 🪵) takes ~60s to afford — appearing unbuyable. The chain trace shows it's bought at second 29. **Compounding upgrades make later purchases dramatically cheaper than static math predicts.**

The simulation script automates these chain traces across every strategy, so we don't have to do them by hand.

### Opportunity Cost

Payback period alone doesn't capture the full picture. In our idler mode, switching highlight to farm ale means you're _not_ producing wood at the boosted rate. The **true cost** of an ale-based upgrade is:

```
true_cost = upgrade_cost_in_ale + (wood_production_lost_during_farming × farming_duration)
```

This is an approximation — it overstates the detour cost because ale also trickles in passively at 1/s while you're highlighting wood. For example, after 14s of mostly highlighting wood, a player has ~9🍺 from passive ale alone. Account for this passive accumulation when computing the true farming duration needed.

This "hidden cost" (even after adjusting for passive gains) is what makes the choice interesting.

### The k Heuristic (for designing new upgrades)

When creating a _new_ upgrade, you need to pick a cost. The **k heuristic** is a shorthand for this: it asks _"What fraction of the remaining time should the player spend just breaking even after buying this upgrade?"_

| k value | Break-even window | Game feel |
|---|---|---|
| **0.3** | 30% of remaining time | Generous — decisions feel easy and safe |
| **0.4–0.5** | ~Half the remaining time | **Sweet spot** — rewarding but not free |
| **0.7** | 70% of remaining time | Risky — late purchases are traps, timing is critical |

Pick the time window you want the upgrade purchased in, choose a k, and derive the cost:

```
max_cost = benefit_per_sec × time_remaining_at_intended_purchase × k
```

This applies to **additive rate upgrades**. For multipliers, substitute the effective additive gain at the expected game state. For one-time conversions, use the conversion value framework from the caveat in Section 1 instead.

This gives a **starting point** for the cost. Fine-tune it by running a chain trace (or the simulation script) to verify it plays well alongside the other upgrades.

---

## 2. The Five Design Levers

| # | Lever | What it controls | Target |
|---|---|---|---|
| 1 | **Time-to-first-decision** | How long before the player can buy _something_. Too fast = no anticipation. Too slow = boredom. | **8–15 seconds** in a 60s round |
| 2 | **Decision density** | Number of meaningful choices per round. Fewer = scripted experience. More = overwhelming. | **3–5 decisions** in a 60s round |
| 3 | **Opportunity cost** | Choosing path A should cost you path B. This is the engine of interesting play. | Every purchase should have a visible trade-off |
| 4 | **Strategy parity** | Multiple viable paths should yield similar total scores (within ~10–15%). If one path dominates, there's no real choice. | ≥ 2 viable strategies within 10–15% score |
| 5 | **Growth curve shape** | Score-over-time should be convex (accelerating). Early seconds are cheap; final seconds are where investment pays off. | Exponential-ish, not linear |

### Expanded Notes

**Time-to-first-decision** sets the emotional rhythm. The early seconds are "reading the board." If the first purchase is available at second 3, the player never has time to form a plan. If it's at second 25, they've already tuned out.

**Decision density** is not the same as "number of upgrades." One upgrade can create multiple decision points: _when_ to buy it, _what to sacrifice_ to afford it, _whether_ to buy it at all. The goal is ~1 meaningful decision every 12–20 seconds. Importantly, a "meaningful decision" requires **at least two viable options** — a forced-order purchase sequence has high _count_ but zero _branching factor_. A game where you always buy A → B → C in that order has 3 purchases but arguably 0 real decisions.

**Strategy parity** is the hardest to get right and the most rewarding when you do. The ideal state: two players with different strategies both feel like their approach was clever, and the outcome is determined by _execution quality_ (timing, resource management) rather than _strategy choice_.

**Growth curve shape** creates the "feeling of acceleration" that makes incremental games satisfying. A linear curve (constant production) feels boring. A convex curve (production increases over time) creates the feeling that your decisions are compounding — that you're _getting somewhere_.

In our game, growth is a **staircase**: flat within each interval (constant rate), with jumps when upgrades are purchased. The "convex" target means the staircase should have **increasing step heights** and steps distributed throughout the round — especially in the second half. If all jumps happen in the first 30 seconds and the last 30 are a single flat line, the curve is convex early but linear late, which feels like the game peaked too soon.

---

## 3. Setting Constants: The Framework

### Step 1: Define the Ideal Timeline

Work backwards from the round duration. For a 60-second round:

```
 0–12s    Accumulation phase    Build toward first purchase.
12–30s    Mid-game pivot        1–2 purchases reshape the strategy.
30–50s    Execution phase       High rates pay off; late-game purchases add final staircase steps.
50–60s    Final sprint          Last-chance decisions, conversion plays.
```

### Step 2: Set Costs to Hit Target Windows

Compute how many resources the player will have accumulated at the intended purchase time (using a chain trace from Section 1), then apply a spend fraction:

```
cost = total_accumulated_at_target × spend_fraction
```

`spend_fraction` ≈ 0.6–0.7 — the player should spend most (but not all) of their accumulated resources on the purchase. Having leftover resources avoids the "I'm broke and helpless" feeling.

The chain trace is essential here because the production rate changes with each earlier purchase. A player earning 1/s, then 4/s, then 8/s across different intervals does not accumulate `8 × 29 = 232` — they accumulate ~121. Always trace the full sequence.

### Step 3: Compute Benefit to Ensure Payback

For **additive rate upgrades**, given the cost and the time window, the upgrade's benefit must satisfy:

```
benefit_per_sec ≥ cost / (time_remaining × k)
```

Where `k` is the design heuristic from Section 1 (typically 0.4–0.5). This ensures the upgrade pays for itself within the break-even window, leaving the rest of the time as pure profit.

For multipliers and one-time conversions, this formula doesn't apply directly — see the caveat in Section 1.

### Step 4: Verify Strategy Parity

Simulate (mentally, on paper, or with a script) at least two distinct strategies through the full round. Compare total scores. If one dominates by > 15%, either:

- Increase the cost of the dominant strategy's key upgrade
- Increase the benefit of the weaker strategy's key upgrade
- Reduce the opportunity cost of the weaker path

### Step 5: Check the Feel

Numbers can be correct and the game can still feel bad. After the math checks out, play-test for:

- **Idle anxiety**: Is the player stressed about doing nothing? (Some is good; too much means the tick rate is too high or time pressure is too aggressive.)
- **Decision regret**: Does the player feel punished for exploring? (Bad. The weaker strategy should still be _viable_, just suboptimal.)
- **Endgame flatness**: Do the last 10 seconds feel productive? (If the growth curve flattens, add a late-game multiplier or conversion mechanic.)

---

## 4. Idler Mode Analysis

### Current State (as of `820ee67`)

**Production rates** (per second, by highlight state and upgrades):

| Highlight | 🪵 Wood (no upgrades) | 🪵 Wood (+TR) | 🪵 Wood (+TR +SA) | 🪵 Wood (+TR +SA +LM) | 🍺 Ale |
|---|---|---|---|---|---|
| 🪵 Wood | 2 | 4 | 8 | 16 | 1 |
| 🍺 Ale | 1 | 2 | 2 | 4 | 2 (no SA), 4 (with SA) |

The **pre-multiplier base rates** are: 1 🪵/s wood, 1 🍺/s ale. Upgrades like Tavern Recruits (+1) and Lumber Mill (+2) increase the pre-multiplier wood base. The highlight multiplier (2× default, 4× with SA) is then applied to whichever currency is highlighted. The non-highlighted currency always produces at its pre-multiplier base (1×).

**Score formula:** `score = total wood ever produced` (ale doesn't count toward score).

**Upgrades:**

| Upgrade | Cost | Currency | Time to Afford (static) | Time to Afford (best case) | Viable in 60s? |
|---|---|---|---|---|---|
| 🪓 Sharpened Axes | 40 🪵 | wood | ~20s @ 2/s | ~14s (after TR → 4/s) ¹ | ✅ Core purchase |
| 🏗️ Lumber Mill | 120 🪵 | wood | ~60s @ 2/s | ~29s (after TR + SA → 8/s) ¹ | ✅ Viable via upgrade chain |
| 🍻 Tavern Recruits | 10 🍺 | ale | ~10s @ 1/s | ~5s (ale highlighted → 2/s) ² | ✅ Early detour |
| 🫗 Liquid Courage | 35 🍺 | ale | ~35s @ 1/s | ~18s (ale highlighted → 2/s) ² | 🤔 Niche / situational |

> ¹ Chained: earlier upgrades boost production rate, making later upgrades affordable sooner.
> ² Highlighted: player switches highlight to ale (2/s) as a deliberate choice, not a result of earlier purchases.

### Observed Play: "All-In" Strategy (~613 score)

```
 0– 5s   Highlight ale → farm 10🍺
    5s   Buy Tavern Recruits → base wood = 2
 5–14s   Highlight wood → 4/s → ~41🪵
   14s   Buy Sharpened Axes → highlight = 4×, rate = 8/s
14–29s   Highlight wood → 8/s → ~120🪵
   29s   Buy Lumber Mill → rate = 16/s
29–60s   31s at 16/s → ~496🪵
         Total ≈ 657 (theoretical) / ~613 (with human latency)
```

Note the razor-thin margin: the player has ~1🪵 left after buying Lumber Mill. Both SA and LM cost ~99% of accumulated resources (spend fraction ≈ 0.99), far above the 0.6–0.7 target from Section 3 Step 2. This means a player who buys Tavern Recruits even one second late cascades through the chain and makes LM unaffordable. The framework predicts this: when spend fraction approaches 1.0, there's no slack, no room for alternative timing, and no leftover resources to pursue a side path.

This buys all three production upgrades. The question is whether any alternative strategy can compete.

### Timeline Mapping

Comparing the observed play against the ideal timeline (Section 3, Step 1):

| Phase | Ideal | Observed | Status |
|---|---|---|---|
| 0–12s Accumulation | Build toward first purchase | TR at 5s, farming for SA | ⚠️ First buy at 5s is below the 8–15s target |
| 12–30s Mid-game pivot | 1–2 strategy-shaping purchases | SA at 14s, LM at 29s | ✅ Two pivotal purchases |
| 30–50s Execution | High rates pay off; late purchases add steps | Pure idle at 16/s | ⚠️ No decisions — just watching numbers go up |
| 50–60s Final sprint | Last-chance decisions | Pure idle at 16/s | ❌ Nothing to do |

The first half of the round fits the framework well. The second half is entirely empty — 31 seconds with no agency. This is the primary balance problem.

### Identified Problems

1. **Decision tree may be too linear.** The "all-in" path (TR → SA → LM) seems dominant. Is there a competitive strategy that skips one of these? Needs simulation to confirm.

2. **Ale has weak pull beyond Tavern Recruits.** The ale detour at 0–5s is worthwhile, but once TR is bought, ale has little purpose until Liquid Courage — and LC requires a long farming window.

3. **Liquid Courage has unclear timing.** The conversion is powerful in theory but the ale stockpile is usually small (it accumulates at 1/s while you're highlighting wood). When is the right time to switch back to ale for LC?

4. **No late-game decision and linear growth curve.** After buying Lumber Mill at ~29s, the remaining 31 seconds are pure idle — no decisions to make, no tension. The growth curve is perfectly linear (constant 16/s), which directly violates the "convex / exponential-ish" target from Section 2. The game needs something to _do_ and something to _accelerate_ in the back half of the round.

---

## 5. Lessons Learned

_This section grows as we iterate. Each entry captures a specific insight from balancing work._

> (No entries yet — to be filled as we apply the framework and learn from results.)

<!-- Template for new entries:
### Lesson N: [Title]
**Date:** YYYY-MM-DD
**Context:** What we were trying to do.
**Observation:** What we noticed.
**Conclusion:** The takeaway for future balancing work.
-->
