# Queue-Based Strategy Simulation — Design Plan

## Verdict

**Good idea, worth doing.** The current exhaustive-enumeration approach
([client/src/dev/strategies.ts](../../client/src/dev/strategies.ts)) has hit a
wall: it enumerates `2^n` upgrade subsets (capped at `MAX_ENUM_UPGRADES = 8`)
and models only two action types (`buy`, `set_highlight`). It cannot express
generators, clicks, or the mechanics that now dominate the game.

A hand-authored **action queue** — an _ordered_ list of actions with **no
timestamps** — is the right abstraction. The author decides _what order_ things
happen in; the simulation decides _when_ by advancing time until each action can
fire, then moving to the next. This scales to any mode, expresses every
mechanic, turns strategies into reusable file-backed fixtures for the balance
envelope work in [05-balance-design.md](05-balance-design.md), and — crucially
for a _balance_ tool — is **robust to rebalancing**: retuning costs re-derives a
strategy's timing instead of silently invalidating hand-authored timestamps.

> **Note — this supersedes an earlier "timeline" design.** A prior draft made
> each action carry a `timeSec` and proposed skip/wait semantics for actions
> that fire while unaffordable. We reversed that: authoring timestamps just moves
> affordability math onto the author and rots the moment costs change. The queue
> model below makes _order_ the author's intent and lets timing emerge. See
> [Relationship to the timestamp draft](#relationship-to-the-timestamp-draft).

---

## Problem Statement

Today's simulator ([client/src/dev/simulate.ts](../../client/src/dev/simulate.ts)):

- **Enumerates** every valid upgrade subset and derives a purchase order. This
  is exponential and already disabled beyond 8 upgrades.
- Models only `buy` and `set_highlight`. It **cannot** buy generators or click.
- Has no authorable, saveable representation of a strategy — you can't hand a
  colleague "the strategy that won" as a file, or diff two of them in git.
- Encodes reaction time only through the `highlightDelaySec` hack.

Meanwhile the real game now has: upgrades, generators (with geometric cost
scaling), a clicker (rate-limited manual income), a highlighter (routes passive
income to one resource), and an attack panel (passive enemy debuffs). No single
sim can express a realistic play session.

We want the **Simulation panel** in the dev panel to let the user _author_ a
strategy as an ordered queue, run it, chart it, and **save/load** it to/from
files.

---

## Core Concept: A Strategy Is an Ordered Queue

A **strategy** is an ordered list of **actions**. There are **no timestamps**.
The engine processes actions strictly in order: for each action it advances
simulated time until the action's condition is satisfied, applies it, then moves
to the next. Timing is an _output_ of the run, not an input.

### The one primitive: _advance until, then apply_

Every action reduces to "advance simulated time until condition `C` holds, then
apply effect `A`." The action kinds differ only in what `C` is:

| Kind             | Condition `C` (advance until…)          | Effect `A`                                   |
| ---------------- | --------------------------------------- | -------------------------------------------- |
| `buy`            | upgrade is valid + affordable           | purchase `count` upgrade levels (default 1)  |
| `buy_generator`  | generator is valid + affordable         | purchase `count` generator units (default 1) |
| `set_highlight`  | _always true_ (instant)                 | switch the highlighted resource              |
| `set_click_rate` | _always true_ (instant)                 | set the background clicking rate             |
| `wait`           | an explicit `WaitCondition` (see below) | _none_ (barrier only)                        |

A `buy` / `buy_generator` with `count: N` (default 1) is shorthand for **N
back-to-back single purchases**: each level/unit blocks until it is individually
affordable — ticking meanwhile — and the cursor advances only after the Nth. If
the target maxes out (or a choice group closes) before N, the remaining
purchases are reported as capped/not-reached rather than stalling the queue
forever.

Instant actions (`set_highlight`, `set_click_rate`) fire with no time passing and
the cursor advances immediately. `buy` / `buy_generator` **block**: the sim ticks
forward — earning passive, generator, and background-click income — until the
purchase is valid and affordable, then executes it. `wait` blocks on an
author-specified predicate.

### Clicking is a persistent background rate (not a burst)

`set_click_rate { resource?, cps }` sets an ongoing clicking rate that **stays in
effect until changed**. There are no click "bursts" and no durations to author:
while a later `buy` blocks waiting to become affordable, the background clicking
is what _earns_ that affordability, and the clicking phase's duration emerges
from how long the buys take. `cps: 0` stops clicking. The rate is clamped to
`MAX_CPS` (`= 20`, exported from `@game/shared`); `meta.peakCps` tracks the
highest rate ever set so `relativeModifier` effects sourced from `meta:peakCps`
behave correctly.

### `wait` is a predicate barrier

`wait` advances time until a condition holds (or the round ends). Conditions:

| `WaitCondition`     | Fields               | Advance until…                                            |
| ------------------- | -------------------- | --------------------------------------------------------- |
| `seconds`           | `seconds`            | this many seconds have elapsed **since the wait started** |
| `resource_at_least` | `resource`, `amount` | that resource's **spendable balance** ≥ `amount`          |

`seconds` is a delta measured **relative to the moment the wait begins**;
`resource_at_least` is a level check on the current balance. Together they cover
deliberate save-up ("wait until I've stockpiled 500 r0, _then_ buy") with **no
new engine state at all** — they were chosen precisely because they're the two
cheapest conditions to implement.

> **Deferred — `clicks` and `resource_gained`.** Two richer barriers are
> intentionally **out of v1**. `clicks` ("wait until `count` clicks since the
> wait started") needs a cumulative-click counter; `resource_gained` ("wait until
> this resource is _earned_ by `amount`") needs per-resource cumulative-earned
> accumulators plus a precise "earned" definition. Neither is needed for the
> near-term authoring goals. See [Deferred to future work](#deferred-to-future-work).

### Proposed types (design sketch — not final code)

```typescript
// shared/src/simulation/strategy.ts (proposed home — see "Where code lives")

type SimAction =
  | { kind: 'buy'; upgradeId: string; count?: number } // count defaults to 1
  | { kind: 'buy_generator'; generatorId: string; count?: number } // count defaults to 1
  | { kind: 'set_highlight'; highlight: string }
  | { kind: 'set_click_rate'; resource?: string; cps: number }
  | { kind: 'wait'; until: WaitCondition }

type WaitCondition =
  | { kind: 'seconds'; seconds: number }
  | { kind: 'resource_at_least'; resource: string; amount: number }
// deferred (see "Deferred to future work"):
// | { kind: 'clicks'; count: number }
// | { kind: 'resource_gained'; resource: string; amount: number }

interface QueueStrategy {
  /** Schema version for forward-compatible save files. */
  version: 1
  name: string
  mode: GameMode
  /** Processed strictly in order; no timestamps. */
  actions: SimAction[]
}
```

---

## Execution Semantics (the key decision)

The engine walks `actions` with a single cursor:

1. **Instant action** (`set_highlight`, `set_click_rate`): apply, advance cursor,
   no time passes.
2. **Blocking action** (`buy`, `buy_generator`): each tick, re-check
   validity+affordability via the shared validators (see anti-drift below). When
   satisfied, execute and advance the cursor. Time advances meanwhile with the
   active click rate + passive + generator income.
3. **`wait`**: each tick, evaluate the predicate against live state; advance the
   cursor when true.

**Termination is the round timer.** The round has a fixed `durationSec`; that is
the hard stop. Whatever actions remain in the queue when time expires are
reported as **"not reached"** (with the blocking condition that was never met).
There is _no_ skip and _no_ per-action override — an unaffordable buy simply
keeps the cursor parked until it becomes affordable or the round ends. This
deletes the entire skip/wait/`onUnaffordable` decision that dogged the timestamp
draft.

**Deadlock is benign but reported.** If a blocking action can never be satisfied
(prereq or choice-group can't be met, or income is ≤0 and the cost is
unaffordable), the sim just runs to round end and reports it as not-reached. A
cheap "no progress possible" detector (income ≤ 0 **and** condition unmet **and**
no pending instant actions ahead) may end the run early as an optimization, but
the round timer is the correctness backstop.

---

## Simulation Engine Changes

The existing loop in [simulate.ts](../../client/src/dev/simulate.ts) is close.
Changes:

1. **Drive by a queue cursor, not subset enumeration.** Hold the current cursor;
   each tick, resolve as many _instant_ actions as are ready, then evaluate the
   current _blocking_ action's condition.
2. **Support all five action kinds.** Route each to the same application logic
   the server uses (see next section).
3. **Background clicking.** Each tick, credit
   `clicksThisTick = min(cps, MAX_CPS) × tickSec` clicks at the current
   `set_click_rate`, each worth `computeClickIncome(modifiers)`. Because click
   income depends on modifiers (which change as upgrades are bought), recompute
   per tick rather than pre-multiplying. Track `meta.peakCps`.

   > **Fidelity note:** the server enforces `MAX_CPS` as a discrete count over a
   > rolling 1-second window using _server_ timestamps ([isValidClick](../../server/src/validation.ts));
   > the sim uses a continuous per-tick approximation. Acceptable for a balance
   > sim, but not bit-identical — the sim slightly over-counts at fractional-tick
   > boundaries.

4. **Keep the score semantic:** only the score resource contributes to
   `state.score`, matching [match.ts](../../server/src/match.ts) `applyClick` /
   `applyPassiveTick`. `meta.peakCps` is still tracked (for `relativeModifier`
   effects). **No per-resource earned tracking and no cumulative-click counter in
   v1** — both are needed only by the deferred `resource_gained` / `clicks` wait
   conditions (see [Deferred to future work](#deferred-to-future-work)).
5. **Enemy debuffs — deferred.** v1 is single-player (no opponent), so
   self-only attacks are moot. Leave a `collectEnemyDebuffs` hook for a later
   "vs" plan (two authored queues against each other) but do not build it now.

### Eliminate engine drift (important — now the core loop condition)

Right now the sim has its own `executeAction` / `canAfford`, separate from the
server's `processActions` in [match.ts](../../server/src/match.ts). They already
diverge: the sim's `canAfford` checks `isMaxed` + `isPrerequisiteSatisfied` +
`isCostAffordable` but **omits the choice-group check** the server's
`isValidPurchase` enforces via `isChoiceGroupAvailable`. In the queue model this
validity check is no longer a guard — it is the **loop condition that decides
when time stops advancing** — so drift here directly corrupts every run's timing.

**Extract a shared, pure action-applier** —
`applySimAction(state, action, modeDef): ApplyResult` — into
`shared/src/simulation/`, and reuse the _same_ validators the server uses.

> **Dependency caveat:** the two validators the sim needs —
> `isValidPurchase` and `isValidGeneratorPurchase` — currently live in
> [server/src/validation.ts](../../server/src/validation.ts) (lines 39 / 65),
> and **`shared` cannot import from `server`**. Resolution (Resolved Decision 7):
> **move both validators down into `shared/`** (they are pure and built entirely
> from shared primitives — `isMaxed`, `isPrerequisiteSatisfied`,
> `isChoiceGroupAvailable`, `getUpgradeNextCost`, `isCostAffordable`,
> `canAffordGenerator`, `isGeneratorUnlocked`, `resolveGeneratorDef`). The server
> then re-imports them from shared, so server and sim share one implementation.
>
> The application helpers the sim also calls — `applyPurchase`,
> `applyGeneratorPurchase`, `computeClickIncome`, `isClickUnlocked`,
> `isHighlightActive` — are **already in `shared`**, so those are safe to reuse
> directly.

This is the single most valuable correctness investment here.

---

## Save / Load to Files

Strategies become first-class documents.

- **Format:** JSON matching `QueueStrategy`, `version`-stamped for
  forward compatibility.
- **Validation:** a zod schema at the trust boundary (matches the tree codec and
  effect-ref pattern). Reject unknown modes; `cps` outside `[0, MAX_CPS]`;
  non-positive `wait` amounts; `count` that isn't a positive integer; and
  references to nonexistent upgrade/generator/resource IDs for the selected mode.
  (No timestamp range or `onUnaffordable` validation — those concepts are gone.)
- **Location:** `shared/trees/` already holds authored JSON; propose a sibling
  `shared/strategies/<mode>/*.json` for git-tracked reference strategies (these
  double as the envelope fixtures for [05-balance-design.md](05-balance-design.md)
  Phase C / CI).
- **Browser I/O:** the dev panel is a static page. Use the File System Access
  API where available (`showSaveFilePicker` / `showOpenFilePicker`) with a
  download-blob + file-input fallback. No server round-trip needed.
- **Round-trip guarantee:** load → edit → save must be lossless and stable
  (pretty-printed, key order fixed) so git diffs are clean. Order is authoritative
  and preserved verbatim — there is no re-sort step.

---

## Dev Panel UI

Extend the existing Simulation tab ([client/src/dev/ui.ts](../../client/src/dev/ui.ts)),
vanilla DOM + uPlot, reusing the current chart pipeline.

- **Strategy list / picker:** authored strategies (loaded from files) alongside
  any kept seed-generated ones. Multi-select to compare (as today).
- **Queue editor** for the selected strategy:
  - An **ordered** table of rows: `# | kind | target | params | ↑ ↓ | ✎ | 🗑`.
    Order is the model — reordering is **move up / move down** (drag optional),
    _not_ sort-by-time.
  - "Add action" → pick kind → contextual fields: upgrade/generator dropdowns
    (populated from the mode) plus a `count` field (default 1) for buys; resource
    dropdown for highlight/click; `cps` for `set_click_rate`; a `WaitCondition`
    sub-editor for `wait` (condition-kind dropdown → contextual fields).
  - Inline edit + delete.
- **Run:** simulate selected strategies (optionally perfect and
  `highlightDelaySec`-delayed variants, as today) and render:
  - Score-over-time chart. Action markers sit at the **derived** fire-time of each
    action (green = applied; amber = still-blocked/not-reached at round end).
  - Income + per-resource stockpile charts (existing).
  - A run report table: final score, per-action fire-times, any not-reached
    actions (with the unmet condition), checkpoint pass/fail if an envelope
    exists for the mode.
- **Save / Load / New / Duplicate** buttons wired to the file I/O above.
- **Envelope overlay:** reuse [shared/src/balance](../../shared/src/balance)
  (`validateEnvelope`) — authored strategies become the input `SimScore[]`.

---

## Where Code Lives

Per [05-balance-design.md](05-balance-design.md) Phase C, the **engine and
strategy types are mode-agnostic and belong in `shared/`**; the **UI stays in
the client**:

| Concern                     | Location                            |
| --------------------------- | ----------------------------------- |
| `QueueStrategy` types + zod | `shared/src/simulation/strategy.ts` |
| `applySimAction` (pure)     | `shared/src/simulation/apply.ts`    |
| `simulate()` engine         | `shared/src/simulation/simulate.ts` |
| Reference strategy JSON     | `shared/strategies/<mode>/*.json`   |
| Queue editor + file I/O     | `client/src/dev/` (Simulation tab)  |

Moving the engine to shared also unlocks the CI balance check
(`scripts/check-balance.ts`) without bundling the client.

---

## Relationship to the timestamp draft

The prior draft stamped each action with `timeSec` and needed skip/block/retry
semantics for actions that fired while unaffordable. The queue model drops all of
that: order replaces timestamps, blocking replaces skip, and clicking-as-rate
replaces click bursts. Net effect — one fewer field per action, one fewer
sub-decision per buy, and no strategy rot on rebalance.

## Relationship to the Old Enumeration

- **Keep** `generateStrategies` as an optional "seed" button that emits _ordered
  queues_ (its sequential `buy`/`set_highlight` output maps directly to a queue —
  drop the affordability-timestamp derivation entirely; the engine recovers
  timing at run). This gives authors a starting point instead of a blank queue.
- **Demote** it from the default: the panel no longer auto-runs `2^n` subsets;
  authored/loaded strategies are primary.

---

## Phasing

1. **Phase 1 — Types + engine in shared.** Add `QueueStrategy`, zod schema,
   `applySimAction`, and the cursor-driven `simulate()` in
   `shared/src/simulation/`. Move `isValidPurchase` / `isValidGeneratorPurchase`
   into shared; re-import from server. Unit tests with a synthetic mode (mirror
   the existing `modeDef` override test hook). No UI yet.
2. **Phase 2 — Full action set** in the engine: `set_click_rate` background
   clicking (with `MAX_CPS` clamp + `peakCps`), generator cost scaling, and the
   two v1 `wait` predicates (`seconds`, `resource_at_least`). Tests for
   blocking-until-affordable, multi-`count` buys (including capping at max),
   not-reached reporting, click clamping, each wait condition, and
   deadlock-at-round-end.
3. **Phase 3 — Dev panel queue editor** (add/edit/delete/reorder, run, markers).
4. **Phase 4 — Save/Load** (zod-validated JSON, File System Access + fallback,
   `shared/strategies/` reference set).
5. **Phase 5 — Envelope integration** (overlay + report reuse) and optional
   `generateStrategies`-as-seed button.

---

## Deferred to future work

- **`clicks` wait condition.** "Wait until `count` clicks have been credited
  since the wait began." Needs a single cumulative-click scalar summed per tick —
  cheap, but not needed for v1's authoring goals. Add the
  `{ kind: 'clicks'; count }` variant (and the counter) when a strategy actually
  needs click-count gating.
- **`resource_gained` wait condition.** "Wait until this resource is _earned_ by
  `amount`." Requires per-resource cumulative-earned accumulators plus a precise
  "earned" definition — positive credits only; a resource consumed as a
  generator's _input_, and resources spent on a purchase, do **not** count. These
  accumulators stay **sim-local** (never on `PlayerState`, which ships over the
  wire — this is a dev-only feature). When added, extend `WaitCondition` with the
  `{ kind: 'resource_gained'; resource; amount }` variant and bump the strategy
  `version`. Until then, ordering + `resource_at_least` + `seconds` cover the
  authoring needs.
- **Enemy debuffs / "vs" runs.** Two authored queues against each other, wiring
  the `collectEnemyDebuffs` hook. v1 is single-player only.
- **Routing the server tick through `applySimAction`.** v1 shares the _validators_
  but the server keeps its own tick/income path; folding the two fully is a later
  anti-drift step.

## Resolved Decisions

1. **Ordered queue, no timestamps.** The author controls _order_; the engine
   derives _timing_ by advancing time until each action can fire. Robust to
   rebalancing; no timestamp authoring.
2. **Blocking, not skipping.** A buy that isn't yet affordable parks the cursor
   until it is (or the round ends). No skip, no `onUnaffordable`. Unreached
   actions are reported. The round timer is the hard stop.
3. **Clicking is a persistent background rate.** `set_click_rate {resource?, cps}`
   stays on until changed (`cps: 0` stops); no bursts, no durations. Clicking
   duration emerges from how long the following buys take. Clamped to `MAX_CPS`.
4. **`wait` is a predicate barrier — v1 ships only the two zero-cost conditions:**
   `seconds` (elapsed) and `resource_at_least` (current balance). **`clicks` and
   `resource_gained` are deferred** (they need a cumulative-click counter and
   per-resource earned tracking respectively — see
   [Deferred to future work](#deferred-to-future-work)). Ordering + these two
   cover deliberate save-up.
5. **Multi-buy via `count`.** `buy` and `buy_generator` take an optional `count`
   (default 1), applied as N back-to-back blocking purchases, so multi-level
   upgrades and stacked generators are one queue row rather than N. A relative
   `count` (not a target level) is unambiguous because a sim run always starts
   from a known zero state.
6. **Single-player only in v1.** No opponent; self-only attacks are moot. The
   engine keeps a `collectEnemyDebuffs` hook for a future "vs" plan but v1 does
   not wire it.
7. **Move the validators into `shared`; keep server as a consumer.**
   `isValidPurchase` / `isValidGeneratorPurchase` relocate from
   `server/src/validation.ts` into `shared/` so `applySimAction` and the server's
   `processActions` share one validity implementation. Fully routing the server
   tick through `applySimAction` itself is deferred.
8. **Keep the perfect/delayed dual run** for continuity with the balance envelope
   ([05-balance-design.md](05-balance-design.md)). Explicit `set_highlight`
   ordering models reaction sequencing directly; revisit the dual run if it proves
   redundant.
