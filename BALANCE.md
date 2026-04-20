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

| k value     | Break-even window        | Game feel                                            |
| ----------- | ------------------------ | ---------------------------------------------------- |
| **0.3**     | 30% of remaining time    | Generous — decisions feel easy and safe              |
| **0.4–0.5** | ~Half the remaining time | **Sweet spot** — rewarding but not free              |
| **0.7**     | 70% of remaining time    | Risky — late purchases are traps, timing is critical |

Pick the time window you want the upgrade purchased in, choose a k, and derive the cost:

```
max_cost = benefit_per_sec × time_remaining_at_intended_purchase × k
```

This applies to **additive rate upgrades**. For multipliers, substitute the effective additive gain at the expected game state. For one-time conversions, use the conversion value framework from the caveat in Section 1 instead.

This gives a **starting point** for the cost. Fine-tune it by running a chain trace (or the simulation script) to verify it plays well alongside the other upgrades.

---

## 2. The Five Design Levers

| #   | Lever                      | What it controls                                                                                                         | Target                                         |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| 1   | **Time-to-first-decision** | How long before the player can buy _something_. Too fast = no anticipation. Too slow = boredom.                          | **8–15 seconds** in a 60s round                |
| 2   | **Decision density**       | Number of meaningful choices per round. Fewer = scripted experience. More = overwhelming.                                | **3–5 decisions** in a 60s round               |
| 3   | **Opportunity cost**       | Choosing path A should cost you path B. This is the engine of interesting play.                                          | Every purchase should have a visible trade-off |
| 4   | **Strategy parity**        | Multiple viable paths should yield similar total scores (within ~10–15%). If one path dominates, there's no real choice. | ≥ 2 viable strategies within 10–15% score      |
| 5   | **Growth curve shape**     | Score-over-time should be convex (accelerating). Early seconds are cheap; final seconds are where investment pays off.   | Exponential-ish, not linear                    |

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

### Previous State (as of `820ee67`)

<details>
<summary>Click to expand old analysis (superseded by balance pass below)</summary>

**Upgrades:**

| Upgrade            | Cost   | Currency |
| ------------------ | ------ | -------- |
| 🪓 Sharpened Axes  | 40 🪵  | wood     |
| 🏗️ Lumber Mill     | 120 🪵 | wood     |
| 🍻 Tavern Recruits | 10 🍺  | ale      |
| 🫗 Liquid Courage  | 35 🍺  | ale      |

**Key metrics (simulation):**

| Strategy            | Score | % Best |
| ------------------- | ----- | ------ |
| All-In (TR→SA→LM)   | 660   | 100%   |
| SA-first (SA→TR→LM) | 560   | 85%    |
| Skip TR (SA→LM)     | 280   | 42%    |
| All others          | ≤410  | ≤62%   |

**Problems identified:** (1) Only one viable strategy (All-In dominated everything), (2) TR was mandatory (no-brainer at 5s), (3) LC was worthless (conversion gave ~0 surplus), (4) Spend fractions ≈ 0.99 (no slack), (5) Dead back half (idle from 28.8s — 52% of round with zero agency).

</details>

### Current State (as of balance pass)

**Production rates** (per second, by highlight state and upgrades):

| Highlight | 🪵 Wood (no upgrades) | 🪵 Wood (+TR) | 🪵 Wood (+TR +SA) | 🪵 Wood (+TR +SA +LM) | 🍺 Ale                 |
| --------- | --------------------- | ------------- | ----------------- | --------------------- | ---------------------- |
| 🪵 Wood   | 2                     | 4             | 8                 | 16                    | 1                      |
| 🍺 Ale    | 1                     | 2             | 2                 | 4                     | 2 (no SA), 4 (with SA) |

Production rates are unchanged — only upgrade costs were adjusted.

**Score formula:** `score = total wood ever produced` (ale doesn't count toward score).

**Upgrades:**

| Upgrade            | Old Cost | New Cost  | Currency | Rationale                                            |
| ------------------ | -------- | --------- | -------- | ---------------------------------------------------- |
| 🪓 Sharpened Axes  | 40 🪵    | **30 🪵** | wood     | Lower spend fraction; make SA-first viable           |
| 🏗️ Lumber Mill     | 120 🪵   | **80 🪵** | wood     | Spend fraction 0.99 → ~0.61; buy earlier, more slack |
| 🍻 Tavern Recruits | 10 🍺    | **15 🍺** | ale      | Make ale detour a real decision (7.5s vs 5s)         |
| 🫗 Liquid Courage  | 35 🍺    | **20 🍺** | ale      | Reachable via passive ale trickle (~20s at 1/s)      |

### Simulation Results (post-balance)

| Strategy                  | Score   | % Best  | TR @  | SA @  | LM @  | LC @  | Idle from |
| ------------------------- | ------- | ------- | ----- | ----- | ----- | ----- | --------- |
| All-In (TR→SA→LM)         | 699     | 100%    | 7.5s  | 13.3s | 23.3s | —     | 23.3s     |
| All-In + LC (passive ale) | 699     | 100%    | 7.5s  | 13.3s | 23.3s | 27.5s | 27.5s     |
| All-In + LC (ale rush)    | 684     | 98%     | 7.5s  | 13.3s | 23.3s | 24.5s | 24.5s     |
| **SA-first (SA→TR→LM)**   | **670** | **96%** | 15.0s | 15.0s | 25.0s | —     | 25.0s     |
| Skip TR (SA→LM)           | 410     | 59%     | —     | 15.0s | 35.0s | —     | 35.0s     |
| Skip LM (TR→SA)           | 405     | 58%     | 7.5s  | 13.3s | —     | —     | 13.3s     |
| TR→SA→LC (skip LM)        | 383     | 55%     | 7.5s  | 13.3s | —     | 17.0s | 17.0s     |
| TR only                   | 218     | 31%     | 7.5s  | —     | —     | —     | 7.5s      |
| SA only                   | 210     | 30%     | —     | 15.0s | —     | —     | 15.0s     |
| No upgrades               | 120     | 17%     | —     | —     | —     | —     | 0.0s      |

### What Changed

**✅ Strategy parity improved dramatically.**

- SA-first jumped from 85% → **96%**. It's now a genuine alternative — you skip the ale detour and buy SA at 15s (right at the accumulation target), then detour for TR after.
- The gap between All-In and SA-first (4%) is within the "interesting choice" range from Section 3 Step 4.

**✅ Spend fractions are healthy.**

- SA: cost 30 / ~49 accumulated ≈ **0.61** (was 0.98)
- LM: cost 80 / ~131 accumulated ≈ **0.61** (was 0.99)
- Both right in the 0.6–0.7 sweet spot. There's slack — a 1s delay no longer cascades into missing LM.

**✅ Accumulation timing improved.**

- TR first buy at 7.5s (was 5.0s) — only 0.5s below the 8–15s target instead of 3s below.
- SA-first's first buy at 15.0s — hits the target exactly.

**✅ LC moved from worthless to marginal.**

- Passive ale variant ties at 100% (LC at 27.5s, surplus conversion ~7.5🍺 → 7.5🪵 + score).
- Ale rush variant costs only 2% (was 5%).

**❌ Dead back half is still present (and slightly worse).**

- All-In idles from 23.3s (was 28.8s) — **36.7s of dead time** (was 31.2s).
- The constants-only pass moved purchases earlier without adding late-game content.
- This is the correct outcome: Problem #4 requires a **new mechanic or upgrade**, not constant tuning. Earmarked for the next commit.

### Remaining Problems

1. ~~Decision tree too linear~~ — **Partially resolved.** SA-first at 96% is competitive. Skip-TR paths (59%) are still weak but no longer absurd.

2. ~~Ale weak beyond TR~~ — **Slightly improved.** LC is now reachable, but ale still has limited late-game purpose.

3. ~~LC unclear timing~~ — **Clarified.** Passive ale variant (don't switch highlight, let ale trickle to 20🍺) is strictly optimal. Ale rush is a small trap (-2%).

4. **No late-game decision — NOT fixed.** This is the primary remaining problem. Idle time is 36.7s (61% of the round). Requires new content, not constant changes.

---

## 5. Lessons Learned

_This section grows as we iterate. Each entry captures a specific insight from balancing work._

### Lesson 1: Spend Fraction is the Best Single Diagnostic

**Date:** 2026-04-19
**Context:** First balance pass — the All-In strategy dominated at 100% with all others below 85%.
**Observation:** The root cause of most problems traced back to spend fractions near 1.0. When SA costs 98% and LM costs 99% of accumulated resources: no timing slack (1s delay cascades), no alternative paths (no leftover resources for detours), and no room for LC (ale can't accumulate if you're always broke on wood). Lowering costs to hit 0.6–0.7 spend fraction fixed strategy parity, timing flexibility, and LC viability simultaneously.
**Conclusion:** When multiple balance problems seem unrelated, check spend fraction first. It's the tightest binding constraint — loosening it often resolves several issues at once.

### Lesson 2: Constants Can't Fix Missing Content

**Date:** 2026-04-19
**Context:** Tried to address the "dead back half" (idle from ~29s) through cost reductions.
**Observation:** Lower costs moved purchases earlier (LM at 23s instead of 29s), making the dead window _larger_ (36.7s instead of 31.2s). No arrangement of four upgrades can fill a 60-second round when the optimal strategy completes all purchases by second 23.
**Conclusion:** If the problem is "nothing to do in phase X", the answer is new content for phase X, not tweaking existing content. Constants-only passes are for parity and timing; they can't conjure decisions that don't exist.
