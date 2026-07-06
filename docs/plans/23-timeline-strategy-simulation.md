# Timeline-Based Strategy Simulation — Design Plan

## Verdict

**Good idea, worth doing.** The current exhaustive-enumeration approach
([client/src/dev/strategies.ts](../../client/src/dev/strategies.ts)) has hit a
wall: it enumerates `2^n` upgrade subsets (capped at `MAX_ENUM_UPGRADES = 8`)
and models only two action types (`buy`, `set_highlight`). It cannot express
generators, clicks, or the timing nuances that now dominate the game. A
hand-authored **timeline** — a sorted list of `(timestamp → action)` entries —
is the right abstraction: it scales to any mode, expresses every mechanic, and
turns strategies into reusable, file-backed fixtures that feed the balance
envelope work in [05-balance-design.md](05-balance-design.md).

The main design risk is **scheduling semantics** (what happens when a scheduled
purchase isn't affordable at its timestamp). This plan proposes a concrete
answer. A secondary risk is **engine drift** — the sim currently reimplements
action application separately from the server; this plan folds them together.

---

## Problem Statement

Today's simulator ([client/src/dev/simulate.ts](../../client/src/dev/simulate.ts)):

- **Enumerates** every valid upgrade subset and derives a purchase order. This
  is exponential and already disabled beyond 8 upgrades.
- Models only `buy` and `set_highlight`. It **cannot** buy generators, click, or
  represent bursty clicking.
- Executes actions **sequentially, when affordable** — there is no notion of an
  action happening _at a specific time_. Timing only enters via the
  `highlightDelaySec` reaction-time hack.

Meanwhile the real game now has: upgrades, generators (with geometric cost
scaling), a clicker (rate-limited manual income), a highlighter (routes passive
income to one resource), and an attack panel (passive enemy debuffs). No single
sim can express a realistic play session.

We want the **Simulation panel** in the dev panel to let the user _author_ a
strategy as a timeline, run it, chart it, and **save/load** it to/from files.

---

## Core Concept: A Strategy Is a Timeline

A **strategy** is an ordered list of **scheduled actions**, each stamped with a
time offset (seconds from round start). Conceptually a sorted map
`timeSec → action[]`, but stored/edited as a flat, time-sorted list (multiple
actions may share a timestamp).

### Action kinds

Mirror the real [`PlayerAction`](../../shared/src/types.ts) discriminants so the
sim can reuse the game's own application logic:

| Kind            | Fields                            | Meaning                              |
| --------------- | --------------------------------- | ------------------------------------ |
| `buy`           | `upgradeId`                       | Purchase one upgrade level           |
| `buy_generator` | `generatorId`                     | Purchase one generator unit          |
| `set_highlight` | `highlight` (resource id)         | Switch the highlighted resource      |
| `click`         | `resource?`, `cps`, `durationSec` | Sustained clicking burst (see below) |

The `click` action is the one genuinely new shape. A real click is instantaneous,
but authoring thousands of individual clicks is absurd. Instead a `click` action
describes a **burst**: "starting at `timeSec`, click `resource` at `cps` clicks
per second for `durationSec` seconds." The engine expands it into discrete click
events (clamped to `MAX_CPS`, exported from `@game/shared`).

### Proposed types (design sketch — not final code)

```typescript
// shared/src/simulation/strategy.ts (proposed home — see "Where code lives")

interface ScheduledAction {
  /** Seconds from round start when this action fires. */
  timeSec: number
  action: SimAction
}

type SimAction =
  | { kind: 'buy'; upgradeId: string }
  | { kind: 'buy_generator'; generatorId: string }
  | { kind: 'set_highlight'; highlight: string }
  | { kind: 'click'; resource?: string; cps: number; durationSec: number }

interface TimelineStrategy {
  /** Schema version for forward-compatible save files. */
  version: 1
  name: string
  mode: GameMode
  /** Time-sorted; ties broken by array order. */
  actions: ScheduledAction[]
}
```

---

## Scheduling Semantics (the key decision)

When a `buy` / `buy_generator` fires at its scheduled time but the player can't
afford it (or prereqs aren't met), what happens? Three options:

1. **Skip** — drop the action, record a warning marker, continue.
2. **Block/stall** — hold the action (and everything after it) until affordable,
   shifting the timeline. This is what today's sequential sim effectively does.
3. **Retry-until-deadline** — keep attempting each tick until affordable or the
   next same-target action, then give up.

**Recommendation: Option 1 (skip) as the default, with a per-action
`onUnaffordable: 'skip' | 'wait'` override.** Rationale:

- The whole point of a _timeline_ is that timestamps are the author's intent.
  Silently shifting them (option 2) reintroduces the "when affordable" model the
  user is trying to escape and makes charts misleading.
- Skipping surfaces the mistake loudly (a red marker on the chart + a row in the
  run report: "t=12.0s buy u1 — unaffordable, skipped"), which is exactly the
  feedback an author tuning a strategy wants.
- `wait` remains available per-action for the rare "buy this the instant I can
  afford it" intent.

`set_highlight` and `click` always fire (they have no affordability gate; a
`click` while the clicker is locked simply produces nothing, matching the server
which `continue`s on locked clicks).

---

## Simulation Engine Changes

The existing loop in [simulate.ts](../../client/src/dev/simulate.ts) is close.
Changes:

1. **Drive by absolute time, not a sequential cursor.** Keep the actions
   time-sorted; each tick, fire every action whose `timeSec` falls within
   `(prevTime, tickTime]`.
2. **Support all four action kinds.** Route each to the same application logic
   the server uses (see next section).
3. **Expand `click` bursts.** For a burst active during a tick, credit
   `clicksThisTick = min(cps, MAX_CPS) × tickSec` clicks, each worth
   `computeClickIncome(modifiers)`. Because click income depends on modifiers
   (which change as upgrades are bought), recompute per tick rather than
   pre-multiplying. Track `meta.peakCps` so `relativeModifier` effects sourced
   from `meta:peakCps` behave correctly.

   > **Fidelity note:** the server enforces `MAX_CPS` as a discrete count over a
   > rolling 1-second window using _server_ timestamps ([isValidClick](../../server/src/validation.ts));
   > the sim uses a continuous per-tick approximation. This is acceptable for a
   > balance sim but the two are not bit-identical — the sim slightly
   > over-counts at fractional-tick boundaries.

4. **Keep cumulative-score semantics** — only the score resource contributes to
   `state.score`, matching [match.ts](../../server/src/match.ts) `applyClick` /
   `applyPassiveTick`.
5. **Enemy debuffs — deferred.** v1 is single-player (no opponent), so
   self-only attacks are moot. Leave a hook to layer `collectEnemyDebuffs` from a
   second authored timeline in a later "vs" plan, but do not build it now.

### Eliminate engine drift (important)

Right now the sim has its own `executeAction` / `canAfford`, separate from the
server's `processActions` in [match.ts](../../server/src/match.ts). They already
diverge: the sim's `canAfford` checks `isMaxed` + `isPrerequisiteSatisfied` +
`isCostAffordable`, but **omits the choice-group check** that the server's
`isValidPurchase` enforces via `isChoiceGroupAvailable`. Silent drift like this
is exactly the risk.

**Extract a shared, pure action-applier** —
`applySimAction(state, action, modeDef): ApplyResult` — into
`shared/src/simulation/`.

> **Dependency caveat:** the two _validators_ the sim needs —
> `isValidPurchase` and `isValidGeneratorPurchase` — currently live in
> [server/src/validation.ts](../../server/src/validation.ts), and **`shared`
> cannot import from `server`**. Two options:
>
> 1. **(Recommended)** Move both validators down into `shared/` (they are pure
>    and already built entirely from shared primitives — `isMaxed`,
>    `isPrerequisiteSatisfied`, `isChoiceGroupAvailable`, `getUpgradeNextCost`,
>    `isCostAffordable`, `canAffordGenerator`, `isGeneratorUnlocked`,
>    `resolveGeneratorDef`). The server then re-imports them from shared, so
>    server and sim share one implementation — directly serving the anti-drift
>    goal.
> 2. Reconstruct the validation inside `applySimAction` from the shared
>    primitives. Simpler diff, but leaves two copies of the rule (the drift
>    risk persists).
>
> The application helpers the sim also calls — `applyPurchase`,
> `applyGeneratorPurchase`, `computeClickIncome`, `isClickUnlocked`,
> `isHighlightActive` — are **already in `shared`**, so those are safe to reuse
> directly.

This is the single most valuable correctness investment here.

---

## Save / Load to Files

Strategies become first-class documents.

- **Format:** JSON matching `TimelineStrategy`, `version`-stamped for
  forward compatibility.
- **Validation:** a zod schema at the trust boundary (matches the codebase
  pattern used for the tree codec and effect refs). Reject unknown modes,
  out-of-range `cps`, negative timestamps, references to nonexistent
  upgrade/generator/resource IDs for the selected mode.
- **Location:** `shared/trees/` already holds authored JSON; propose a sibling
  `shared/strategies/<mode>/*.json` for git-tracked reference strategies (these
  double as the envelope fixtures for [05-balance-design.md](05-balance-design.md)
  Phase C / CI).
- **Browser I/O:** the dev panel is a static page. Use the File System Access
  API where available (`showSaveFilePicker` / `showOpenFilePicker`) with a
  download-blob + file-input fallback. No server round-trip needed.
- **Round-trip guarantee:** load → edit → save must be lossless and stable
  (sorted, pretty-printed) so diffs are clean in git.

---

## Dev Panel UI

Extend the existing Simulation tab ([client/src/dev/ui.ts](../../client/src/dev/ui.ts)),
vanilla DOM + uPlot, reusing the current chart pipeline.

- **Strategy list / picker:** authored strategies (loaded from files) alongside
  any kept auto-generated ones. Multi-select to compare (as today).
- **Timeline editor** for the selected strategy:
  - A time-sorted table of rows: `timeSec | kind | target | params | ✎ | 🗑`.
  - "Add action" → pick kind → contextual fields (upgrade/generator dropdowns
    populated from the mode; resource dropdown for highlight/click; `cps` +
    `durationSec` for click).
  - Inline edit + delete; re-sorts on `timeSec` change.
  - `onUnaffordable` toggle per buy row.
- **Run:** simulate selected strategies (optionally both perfect and
  `highlightDelaySec`-delayed variants, as today) and render:
  - Score-over-time chart with **action markers** (green = applied, red =
    skipped-unaffordable).
  - Income + per-resource stockpile charts (existing).
  - A run report table (final score, skipped-action list, checkpoint pass/fail
    if an envelope exists for the mode).
- **Save / Load / New / Duplicate** buttons wired to the file I/O above.
- **Envelope overlay:** reuse [shared/src/balance](../../shared/src/balance)
  (`validateEnvelope`) — authored strategies become the input `SimScore[]`.

---

## Where Code Lives

Per [05-balance-design.md](05-balance-design.md) Phase C, the **engine and
strategy types are mode-agnostic and belong in `shared/`**; the **UI stays in
the client**:

| Concern                        | Location                            |
| ------------------------------ | ----------------------------------- |
| `TimelineStrategy` types + zod | `shared/src/simulation/strategy.ts` |
| `applySimAction` (pure)        | `shared/src/simulation/apply.ts`    |
| `simulate()` engine            | `shared/src/simulation/simulate.ts` |
| Reference strategy JSON        | `shared/strategies/<mode>/*.json`   |
| Timeline editor + file I/O     | `client/src/dev/` (Simulation tab)  |

Moving the engine to shared also unlocks the CI balance check
(`scripts/check-balance.ts`) without bundling the client.

---

## Relationship to the Old Enumeration

- **Keep** `generateStrategies` as an optional "seed" button that emits _authored
  timelines_ (converting its sequential `buy`/`set_highlight` output into
  timestamped actions using each purchase's simulated affordability time). This
  gives authors a starting point instead of a blank timeline, without keeping the
  enumeration as the primary mechanism.
- **Demote** it from the default: the panel no longer auto-runs `2^n` subsets;
  authored/loaded strategies are primary.

---

## Phasing

1. **Phase 1 — Types + engine in shared.** Add `TimelineStrategy`, zod schema,
   `applySimAction`, and the time-driven `simulate()` in
   `shared/src/simulation/`. Unit tests with a synthetic mode (mirror the
   existing `modeDef` override test hook). No UI yet.
2. **Phase 2 — Click + generator support** in the engine, with burst expansion
   and `onUnaffordable` semantics. Tests for skip vs wait, click clamping,
   generator cost scaling.
3. **Phase 3 — Dev panel timeline editor** (add/edit/delete/sort, run, markers).
4. **Phase 4 — Save/Load** (zod-validated JSON, File System Access + fallback,
   `shared/strategies/` reference set).
5. **Phase 5 — Envelope integration** (overlay + report reuse) and optional
   `generateStrategies`-as-seed button.

---

## Resolved Decisions

These were open questions; all are now decided (author agreed with the proposals).

1. **Single-player only in v1.** No opponent. Attacks that only self-affect are
   moot, so they're simply not exercised. A future "vs" plan may run two authored
   timelines against each other; the engine keeps a `collectEnemyDebuffs` hook for
   that but v1 does not wire it.
2. **Clicks are flat bursts.** A `click` action is `{resource?, cps, durationSec}`
   with a constant rate for the duration. No ramp/decay profile in v1.
3. **`onUnaffordable` defaults to `skip`.** An unaffordable scheduled buy is
   dropped with a red marker + report row; `wait` is available per-action for the
   "buy the instant I can afford it" intent. Timestamps stay authoritative.
4. **Move the validators into `shared`; keep server as a consumer.** The two
   purchase validators (`isValidPurchase`, `isValidGeneratorPurchase`) relocate
   from `server/src/validation.ts` into `shared/` so the sim's `applySimAction`
   and the server's `processActions` share one implementation. The remaining
   helpers (`applyPurchase`, `applyGeneratorPurchase`, `computeClickIncome`,
   `isClickUnlocked`, `isHighlightActive`) already live in shared. Fully routing
   the server tick through `applySimAction` itself is deferred.
5. **Keep the perfect/delayed dual run.** Explicit `set_highlight` timing on the
   timeline models reaction time directly, but the perfect-vs-`highlightDelaySec`
   dual run is retained for continuity with the balance envelope
   ([05-balance-design.md](05-balance-design.md)). Revisit if it proves redundant.
