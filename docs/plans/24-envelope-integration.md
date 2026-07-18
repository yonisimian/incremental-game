# Envelope Integration — Design Plan

## Verdict

**Do it.** This is the final deferred piece of
[23-timeline-strategy-simulation.md](23-timeline-strategy-simulation.md)
(its **Phase 5**) and it closes the loop on
[05-balance-design.md](05-balance-design.md) (Phase A.4 overlay + Phase C CI).

The queue-based simulation (plan 23, phases 1–4) is done and merged: authored
strategies live under [shared/strategies/idler/](../../shared/strategies/idler),
they run through the shared `simulate()` engine, and the Queue tab charts them
with a run report. What's missing is the _balance verdict_ — comparing those
runs against a **target envelope** and failing CI when the mode drifts out of
band. Everything needed already exists in
[shared/src/balance/](../../shared/src/balance) (`validateEnvelope`,
`TargetEnvelope`, `SimScore`, `EnvelopeReport`) and was proven by the **old**
Simulation tab; this plan wires it into the **new** Queue tab and into CI.

---

## Problem Statement

Three gaps, one per deliverable:

1. **No envelope verdict in the Queue tab.** `runStrategies` in
   [client/src/dev/queue-sim.ts](../../client/src/dev/queue-sim.ts) charts + reports
   raw scores but never calls `validateEnvelope`. The old Simulation tab
   ([client/src/dev/ui.ts](../../client/src/dev/ui.ts) `renderEnvelopeReport` /
   `toSimScores`) does, but it's bound to the legacy enumeration engine and its
   own `highlightDelaySec` sim — not the queue engine.

2. **No CI balance gate.** [05-balance-design.md](05-balance-design.md) Phase C
   calls for `scripts/check-balance.ts` that loads modes + strategies + envelopes,
   runs the sim, and exits non-zero when the envelope fails. It doesn't exist. The
   engine is _already_ in `shared/` (plan 23 moved it), so a headless Node script
   can import it without bundling the client — the last blocker named in Phase C
   is gone.

3. **The envelope is a placeholder.** `IDLER_TIMED_ENVELOPE`
   ([shared/src/modes/idler-envelope.ts](../../shared/src/modes/idler-envelope.ts))
   is explicitly marked TBD. A report/gate against garbage bounds is noise. We
   calibrate it from real sim output so the verdict means something.

Plus one carry-over from plan 23 Phase 5:

4. **The optional `generateStrategies`-as-seed button** — emit a starter queue
   from the old enumeration so authors don't start from a blank editor.

---

## Design Decisions (resolved up front)

These were settled before writing the plan; recording them so the implementation
doesn't relitigate:

- **D1 — Perfect-timing only; no delayed variant.** `validateEnvelope` takes
  `(envelope, perfect[], delayed[])` because [05](05-balance-design.md) Layer 5
  models player-skill variance by delaying each `set_highlight`. The **new**
  shared `simulate()` has no `highlightDelaySec` option (its `set_highlight` is
  instant), and adding one is real engine + test work for marginal value _right
  now_. **We pass the same `SimScore[]` as both arguments** — every strategy's
  "delayed" score equals its "perfect" score, so viability collapses to "perfect
  timing within band." The report/UI notes this limitation explicitly. Adding a
  real delayed variant is a clean follow-up (extend `SimulateOptions`, thread a
  per-`set_highlight` delay through the engine) and does **not** change any type
  signatures here.

- **D2 — Shaded chart band _and_ report table (both in scope).**
  [05](05-balance-design.md) Phase A.4 wants a shaded min/max region on the score
  chart. The score chart is already time-indexed (x = `timeSec`) and the timed
  envelope is time-indexed (`checkpoint.timeSec → [minScore, maxScore]`), so the
  band is a natural overlay: a filled region between the min-score and max-score
  polylines across the checkpoint times. Implemented as a **new `drawClear` hook**
  in [client/src/dev/chart.ts](../../client/src/dev/chart.ts) plus an optional
  `band` field on `renderChart`'s input. **Hook choice matters:** the chart today
  registers only a `draw` hook, which uPlot fires _after_ the series paint (so the
  existing markers/points sit _on top_ of the lines). A background band must go
  _behind_ the series, so it uses `drawClear` (fires right after the canvas clear,
  before series/axes) — a _different_ hook from the existing one, not the same
  pattern. The table verdict ships too — they're complementary (band = visual
  pacing at a glance; table = per-strategy pass/fail + exploits).

- **D3 — Envelopes for all three goal types (timed + score + race), in scope.**
  The registry is keyed `mode:goalType` and iterates generically, so _plumbing_
  more goal types is nearly free. The **shape**, however, differs by axis:
  - **`timed`** → the existing `TargetEnvelope` (time-indexed **score** bands).
    A run of fixed length; measure score at each time checkpoint. Unchanged.
  - **`target-score` / `buy-upgrade`** → these runs **stop at a variable time**
    (when score hits the target / the goal upgrade is bought), so a score-at-time
    band is meaningless at the end (every finisher is "at target" by
    definition). Their natural envelope is **inverted**: a **pacing envelope** of
    _score→time_ (or, for race, a single _time-to-buy_) bands — "reaching 1000
    should take between T_min and T_max seconds." This is a **new type**
    (`PacingEnvelope` + `validatePacing`) mirroring the score version on the time
    axis. Designed in [Phase 6](#phase-6--goal-pacing-envelopes-score--race-d3).
  - **Name mapping (bug to avoid).** `SimGoal.kind` (`timed`/`score`/`race_to_buy`)
    ≠ `TargetEnvelope.goalType` (`timed`/`target-score`/`buy-upgrade`). A single
    `goalTypeOf(goal: SimGoal): TargetEnvelope['goalType']` helper does the map
    (`score→target-score`, `race_to_buy→buy-upgrade`) in one place; both the
    report and the CI script use it, so the mismatch can't leak.

  > **Sequencing:** the **timed** envelope is the game's competitive reality
  > (rounds are time-limited — `ROUND_DURATION_SEC`) and is the primary
  > deliverable (Phases 1–5). The score/race **pacing** envelopes (Phase 6) are a
  > real generalization but secondary; they land last and are independently
  > droppable if time-boxed, without touching the timed pipeline.

- **D4 — CI gate is warn-then-enforce.** The calibrated envelope must actually
  PASS before the CI step becomes a hard failure, or we redden `main` on merge.
  Sequence within this plan: calibrate first, confirm PASS locally, _then_ add the
  CI step as a hard gate. If calibration can't reach `minViableStrategies: 3` with
  the current authored strategies, we lower `minViableStrategies` to the honest
  achievable count (documented) rather than shipping a red gate.

- **D5 — Disk-load + "authored strategies pass" assertion lives in the CI
  script, not in `shared/tests`.** `shared/src` ships to the **browser** — it
  contains no `fs` import and must not gain one (it would break the client
  bundle; the browser loads strategies via `import.meta.glob`). The Node-side
  loader (`fs` read of `shared/strategies/<mode>/*.json` → `parseStrategy`)
  therefore lives under `scripts/`, and the single assertion "the authored corpus
  passes the real envelope" lives in `scripts/check-balance.ts`. We add
  `pnpm check:balance` to the **pre-push hook** so it runs locally too — so the
  gate fires before push _and_ in CI, without smuggling `fs` into shared or
  cross-importing `scripts/` from `shared/tests`. `shared/tests` still covers the
  _pure_ logic (projection, registry, `validateEnvelope`) with synthetic data.

---

## Balance Philosophy (why this is more than a regression lock)

This is our primary balancing system, so it's worth stating what the envelope
**is** and, more importantly, what it is **not** — because the naïve version is a
trap.

### The calibration tautology (the trap)

If you set each checkpoint band from the _current_ sim output of strategies
`X…Z`, then assert `X…Z` pass, the gate is **tautologically green on day one**
and tells you nothing about whether the game is _fun_ or _fair_ — only that you
can copy numbers. It has genuine value as a **regression detector** (a later
balance change shifts scores out of the frozen bands → CI fails), but zero value
as a statement of **design intent**.

[05-balance-design.md](05-balance-design.md) is explicit that the envelope must
start from the **desired player experience** (pacing skeleton, decision points),
_not_ from whatever the sim currently emits. So we run the envelope in two
registers, and keep them distinct:

| Register            | Bounds come from…               | A failure means…                                          |
| ------------------- | ------------------------------- | --------------------------------------------------------- |
| **Design target**   | intended pacing (hand-authored) | the balance (or the strategy) doesn't match design intent |
| **Regression lock** | current sim output ± tolerance  | something _changed_ the balance since the last baseline   |

Calibration-from-sim (Phase 2) produces only a **starting suggestion** for the
design-target bounds — the designer then nudges them toward the intended feel and
accepts that some current strategies may (correctly) fall outside until the
_balance_ is fixed. The envelope encodes where scores **should** be, not where
they happen to be.

### The re-baselining ritual (so the gate doesn't rot)

A regression lock breaks **every time balance is intentionally tuned** — which is
constant during active balancing. The failure mode is a dev bumping the envelope
numbers to make CI green, which silently defeats the whole system. To prevent
that, updating the envelope is a **deliberate, reviewed** act (like updating a
snapshot test): change balance → run `pnpm check:balance` → **review the score
deltas** → update the envelope _with the justification in the PR body_. The plan
should make this cheap (the script prints a copy-pasteable before/after table)
but never automatic.

### What the envelope does NOT catch (and what does)

- **Unknown dominant strategies / exploits.** The envelope only ever runs the
  strategies we _authored_. It cannot discover a broken combo nobody wrote. Real
  exploit-hunting needs adversarial/space search — the enumeration seed (Phase 5,
  repurposed below) is a cheap first pass; the parameter sweep
  ([05](05-balance-design.md) Phase B) is the real tool. **Named, not built here.**
- **Whether choices are _meaningful_.** A score band can pass while one dominant
  path exists. "Fun" lives in _decision diversity_, which needs a **corpus of
  deliberately-orthogonal strategies** (below) and a **diversity index**
  ([05](05-balance-design.md) Layer 4) — the real next lever after this plan.

### The strategy corpus is the actual signal

`minViableStrategies` and `maxStrategySpread` are only meaningful if the
strategies are genuinely **different approaches**. Today
[shared/strategies/idler/](../../shared/strategies/idler) holds `base.json` plus
three `real-tal*` human recordings (from the Live-export feature) — these are
_similar playthroughs by one person_, not orthogonal archetypes, so "3 viable,
spread 1.1" would be a false comfort. For this to be a professional balance
signal we need a **curated corpus of intentionally-distinct archetypes**, e.g.:

- **Click-rush** — max CPS early, minimal upgrades.
- **Generator-turtle** — buy generators, low interaction.
- **Ale-economy** — commit to the r1 economy + Master-Craftsmen combo.
- **All-in-wood** — single-resource highlight, cheapest-first upgrades.
- **Balanced** — a mixed "intended" line.

Authoring/curating this corpus is a **first-class deliverable** (Phase 2b),
not an afterthought — the envelope is only as honest as the strategies fed to it.

---

## What Already Exists (reuse, don't rebuild)

| Piece                                          | Location                                                                       | Status                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| `validateEnvelope(env, perfect[], delayed[])`  | [shared/src/balance/validate.ts](../../shared/src/balance/validate.ts)         | Done, unit-tested                       |
| `TargetEnvelope`, `SimScore`, `EnvelopeReport` | [shared/src/balance/types.ts](../../shared/src/balance/types.ts)               | Done                                    |
| `IDLER_TIMED_ENVELOPE`                         | [shared/src/modes/idler-envelope.ts](../../shared/src/modes/idler-envelope.ts) | Exists but **placeholder values**       |
| `toSimScores` + `renderEnvelopeReport`         | [client/src/dev/ui.ts](../../client/src/dev/ui.ts) (old tab)                   | Reference impl to port                  |
| `.envelope-*` / `.dev-envelope` styles         | [client/src/dev/dev.css](../../client/src/dev/dev.css)                         | Reusable as-is                          |
| Reference strategies                           | [shared/strategies/idler/](../../shared/strategies/idler)                      | 4 authored; feed the report + CI        |
| `loadBundledStrategies(mode)`                  | [client/src/dev/strategy-io.ts](../../client/src/dev/strategy-io.ts)           | Already seeds the Queue tab             |
| `generateStrategies(modeDef)`                  | [client/src/dev/strategies.ts](../../client/src/dev/strategies.ts)             | Legacy enumeration → seed button source |

The single most reusable asset is `toSimScores` — the exact
`SimResult → SimScore` projection (last snapshot at-or-before each checkpoint
time) we need. It'll move so both the Queue tab and the CI script share it.

---

## Where Code Lives

Per [05](05-balance-design.md) Phase C, envelope logic is mode-agnostic and
already lives in `shared/`; only the projection glue + UI is new.

| Concern                                               | Location                                                | New?                  |
| ----------------------------------------------------- | ------------------------------------------------------- | --------------------- |
| `SimResult[] → SimScore[]` projection (`toSimScores`) | `shared/src/balance/project.ts`                         | **new** (moved down)  |
| `goalTypeOf(SimGoal)` → `TargetEnvelope['goalType']`  | `shared/src/balance/project.ts`                         | **new**               |
| Envelope registry `mode:goalType → (Target\|Pacing)`  | `shared/src/balance/registry.ts`                        | **new**               |
| Calibrated `IDLER_TIMED_ENVELOPE`                     | `shared/src/modes/idler-envelope.ts`                    | edit (values)         |
| `PacingEnvelope` + `validatePacing` (score/race — D3) | `shared/src/balance/pacing.ts`                          | **new** (Phase 6)     |
| Chart band overlay (D2)                               | `client/src/dev/chart.ts`                               | edit (drawClear hook) |
| Envelope report render (Queue tab)                    | `client/src/dev/queue-sim.ts` (or `queue-envelope.ts`)  | **new**               |
| Seed-from-enumeration button                          | `client/src/dev/queue-sim.ts`                           | edit                  |
| CI balance check                                      | `scripts/check-balance.ts`                              | **new**               |
| CI wiring                                             | `.github/workflows/ci.yml` + root `package.json` script | edit                  |

**Why move `toSimScores` to shared?** The CI script (Node, no DOM) and the Queue
tab (browser) both need the identical `SimResult → SimScore` projection. Putting
it in `shared/src/balance/` gives one implementation, unit-testable in the shared
suite, importable from both. The `SimResult` type is already exported from
`@game/shared` (it's the engine's return type). Verified safe: `balance/` →
`simulation/` is a **one-directional** dependency (nothing under
`shared/src/simulation/` imports `balance/`), so no import cycle.

> **Boundary caveat (D5).** The _projection_ is pure and lives in shared. The
> _disk loader_ that reads `shared/strategies/**/*.json` does **not** — `fs` in
> `shared/src` would break the browser bundle. It lives under `scripts/` and is
> reused by the CI script only.

---

## Phasing

Ordered so each phase is independently shippable and the risky calibration lands
before the enforcing gate (D4).

### Phase 1 — Shared projection + registry (foundation, no behavior change)

1. **`shared/src/balance/project.ts`** — export
   `simResultsToScores(results: SimResult[], envelope: TargetEnvelope): SimScore[]`,
   lifted verbatim from the old tab's `toSimScores` (last snapshot at-or-before
   each `checkpoint.timeSec`, default `0`). Pure; unit-tested against a synthetic
   `SimResult`. Also export `goalTypeOf(goal: SimGoal): TargetEnvelope['goalType']`
   (`timed→timed`, `score→target-score`, `race_to_buy→buy-upgrade`) so the
   `SimGoal.kind` ↔ `goalType` name mismatch is resolved in exactly one place
   (D3).
2. **`shared/src/balance/registry.ts`** — export
   `envelopeFor(mode: GameMode, goalType: TargetEnvelope['goalType']): TargetEnvelope | PacingEnvelope | undefined`
   backed by a `Record<'${mode}:${goalType}', …>` seeded with
   `'idler:timed' → IDLER_TIMED_ENVELOPE`. The value type is a union from the
   start (timed → `TargetEnvelope`; score/race → `PacingEnvelope`, added in
   Phase 6) so later goal types are pure data additions, no signature churn.
3. Re-export both from [shared/src/balance/index.ts](../../shared/src/balance/index.ts)
   and the shared barrel.
4. **Tests** (`shared/tests/`): projection picks the right snapshot at exact,
   between, and past-end checkpoint times; `goalTypeOf` maps all three kinds;
   registry hit/miss.

_No UI or CI touched yet. `pnpm --filter @game/shared build && test` green._

### Phase 2 — Calibrate `IDLER_TIMED_ENVELOPE` (the honest-numbers phase)

**This is the phase that makes the verdict mean something (gap 3, D4).** Read the
[Balance Philosophy](#balance-philosophy-why-this-is-more-than-a-regression-lock)
section first — calibration-from-sim produces a _starting suggestion_, not the
final bounds.

1. Run the authored idler corpus through `simulate()` at the timed goal
   (`IDLER_ROUND_DURATION_SEC = 35`; snapshots every `TICK_INTERVAL_MS = 250`ms,
   so the 5/10/15/25/35s checkpoints all land exactly on tick boundaries). Use
   the CI script's runner (Phase 4) in a dry-run mode, not a throwaway snippet,
   so the calibration numbers come from the _same_ path CI will use.
2. Seed each checkpoint's `[minScore, maxScore]` from the observed spread
   (≈ P10 / P90 across strategies), **then adjust toward the intended pacing feel**
   — the bands express design intent, not a snapshot of current output. Following
   the workflow already documented in the file's header comment.
3. Set `minViableStrategies` to the honest achievable count (target 3; if only 2
   land in-band _without distorting the design-intent bounds_, set 2 and document
   why — D4). Set `maxStrategySpread` from the observed best/worst viable ratio.
4. Replace the placeholder block; delete the "TBD" caveats that no longer apply
   (keep the workflow note).
5. **Test** (`scripts` / pre-push, per D5): `pnpm check:balance` asserts the
   corpus passes. This is the lock that keeps future balance changes honest — and
   the exact assertion CI makes. (Pure projection/registry/validate edge cases
   stay in `shared/tests`.)

_Deliverable: `pnpm check:balance` returns `pass: true` for idler timed._

### Phase 2b — Curate a diverse strategy corpus (the signal, not an afterthought)

The envelope is only as honest as the strategies fed to it (see
[Balance Philosophy → corpus](#balance-philosophy-why-this-is-more-than-a-regression-lock)).
Today's files are human recordings, not orthogonal archetypes.

1. Author (via the Queue tab, saving to `shared/strategies/idler/`) a handful of
   **deliberately-distinct** archetypes — click-rush, generator-turtle,
   ale-economy, all-in-wood, balanced. Name them by _approach_, not by author.
2. Keep the `real-tal*` recordings as "real human play" reference points, but the
   **viability/spread verdict is computed over the archetype corpus** so the
   diversity numbers mean something.
3. This phase is what turns "3 viable strategies" from a rubber stamp into a real
   statement that the mode supports multiple approaches. It gates the honesty of
   Phase 2's numbers, so calibrate (2) and curate (2b) **together**, iterating.

> If the archetypes reveal that idler is actually single-path (e.g. click-rush
> dominates everything), that's a **real balance finding** — surface it, don't
> paper over it by loosening the bands. Fixing it is mode-tuning work
> ([05](05-balance-design.md) Phase A.5), trackable as a follow-up.

### Phase 3 — Queue-tab envelope report (gap 1, D1/D3)

1. In `runStrategies` ([queue-sim.ts](../../client/src/dev/queue-sim.ts)), after
   `renderReport`, resolve the envelope for the **active goal's** type —
   `envelopeFor(mode, goalTypeOf(goal))` (D3), _not_ a hardcoded `'timed'`.
   **Dispatch on the envelope kind:** a `TargetEnvelope` (timed) →
   `simResultsToScores` + `validateEnvelope(env, scores, scores)` (same array
   twice — D1); a `PacingEnvelope` (score/race) → `validatePacing` (Phase 6).
   Until Phase 6 lands, score/race simply resolve to `undefined` → the empty
   state, so Phase 3 is shippable before Phase 6.
2. **Duration guard (bug).** The Queue tab's goal-time input lets the user run at
   a duration _shorter_ than a timed envelope's final checkpoint (e.g. run at 20s
   vs a 35s envelope). The projection would then read the last available snapshot
   (20s) for the 25s/35s checkpoints → understated scores → a **spurious FAIL**.
   Guard: only render the timed verdict when the run covers the final checkpoint
   (`runDurationSec >= lastCheckpoint.timeSec`); otherwise show a
   "run ≥ {N}s to evaluate this envelope" notice instead of a misleading fail.
   (Pacing envelopes are goal-terminated, so they have no analogous truncation.)
3. **Render** into a new `#q-envelope` section below the report. Port the old
   tab's markup (verdict banner + per-strategy table + exploit warnings) and
   reuse the existing `.dev-envelope` / `.envelope-*` CSS unchanged (no new CSS,
   so no `lint:css` phantom-class risk and negligible bundle-budget impact). Add
   a small "perfect-timing only" caption (D1). Keep it in `queue-sim.ts` if it
   stays small; split to `client/src/dev/queue-envelope.ts` if it grows past
   ~60 lines.
4. Missing envelope for the active `mode:goalType` → `.envelope-none` "No
   envelope for this goal" (matches the old tab's empty state).
5. **Tests** (`client/tests/`): given crafted `SimResult`s and a tiny envelope,
   the section renders PASS/FAIL, the per-strategy rows, the exploit-warning row,
   the empty state, **and the short-duration guard notice**. (Follow
   `mode-ui.test.ts` DOM-assertion style.)

### Phase 3b — Shaded envelope band on the score chart (D2)

1. **Extend `renderChart`** ([chart.ts](../../client/src/dev/chart.ts)) with an
   optional `band?: { xs: number[]; mins: number[]; maxs: number[]; label?: string }`
   input. Draw it in a **new `drawClear` hook** (fires right after uPlot clears
   the canvas, _before_ it paints axes and series) so the shaded region sits
   behind the score lines, filling between the `mins` and `maxs` polylines using
   `u.valToPos` for coordinate mapping — the same value→pixel helper the existing
   `draw` hook already uses. (The current markers/points live in the `draw` hook,
   which paints _on top_; the band deliberately uses the earlier `drawClear` hook
   instead.) A faint fill + dashed edges; no new dependency.
2. **Wire from the Queue tab** (only for a `TargetEnvelope`, timed): pass the
   checkpoint times as `xs`, `minScore`/`maxScore` as `mins`/`maxs`. The band
   spans only `[firstCheckpoint.timeSec, lastCheckpoint.timeSec]`; outside that
   range draw nothing (don't extrapolate).
3. **Guard rails:** the band is purely presentational — if the band arrays are
   empty or mismatched in length, skip drawing (never throw inside a uPlot hook,
   which would blank the chart). Only the **score** chart gets a band; income /
   per-resource charts are unaffected.
4. **Tests** (`client/tests/`): `renderChart` accepts a `band` without throwing
   and is a no-op when the band is empty/mismatched. (Existing chart tests are
   the template; uPlot canvas pixels aren't asserted — just that the config is
   accepted and hooks don't crash.)

> Phase 3b is self-contained and independently droppable: if the draw-hook math
> gets fiddly, the table verdict (Phase 3) already delivers the verdict. It does
> **not** block Phases 4–6.

### Phase 4 — CI balance gate (gap 2, D4)

1. **`scripts/check-balance.ts`** (run via `tsx`, matching `lint:css`): for each
   `(mode, goalType, envelope)` in the registry, load that mode's authored
   strategies via a **Node-only loader under `scripts/`** (`fs` read of
   `shared/strategies/<mode>/*.json` → shared `parseStrategy`; the loader stays in
   `scripts/`, never in `shared/src` — D5), run `simulate()` at the envelope's
   goal, then **dispatch on envelope kind**: `TargetEnvelope` → project +
   `validateEnvelope`; `PacingEnvelope` → `validatePacing` (Phase 6). Print a
   summary table (strategy → final score / time → within/above/below) **and a
   copy-pasteable before/after band table** to make the re-baselining ritual
   cheap. **Exit non-zero** if any envelope fails `minViableStrategies` or the
   spread limit; print exploit warnings as annotations but **don't** fail on them
   (per [05](05-balance-design.md) Layer 6).
2. **Root `package.json`**: add `"check:balance": "tsx scripts/check-balance.ts"`,
   and append it to the **`pre-push`** hook so the gate also fires locally (D5).
3. **CI** ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)): add a
   "Balance check" step after "Test" (shared is already built by the earlier
   step). Only add this as a **hard** step once Phase 2 confirms PASS locally
   (D4). `simulate()` is deterministic (no `Math.random` / `Date.now`), so the
   gate is reproducible across environments — no flake risk from the engine.
4. **Reuse, don't duplicate:** the script runs the _same_ `simulate()` +
   `simResultsToScores` + `validateEnvelope` over the _same_ JSON files the Queue
   tab bundles, so the CI verdict and the dev-panel verdict can never diverge.

### Phase 5 — Seed-from-enumeration button (plan 23 Phase 5 optional; gap 4)

1. In the Queue tab's strategy controls, add a **"＋ Seed from enumeration"**
   button. On click: call `generateStrategies(modeDef)`
   ([strategies.ts](../../client/src/dev/strategies.ts)), map each legacy
   `Strategy` (`{type:'buy'|'set_highlight', …}`) to a `QueueStrategy` whose
   `actions` are the direct `SimAction` equivalents (`buy` / `set_highlight`;
   drop nothing — the legacy shape is a strict subset), append them to the
   session list, and re-render.
2. Pure converter `enumerationToQueue(strategy, mode): QueueStrategy` next to the
   button (or in `queue-model.ts`), unit-tested for the 1:1 mapping. Mirrors the
   existing `liveActionsToStrategy` pattern from PR #98.
3. **Demote note:** the panel already doesn't auto-run enumeration; this is purely
   additive (a blank-editor escape hatch), satisfying plan 23's "keep as optional
   seed."
4. **Cheap exploit pass (bonus).** Because enumeration emits _many_ strategies
   the author never wrote, running them through the envelope is a first, cheap
   adversarial check: any enumerated strategy that blows past a checkpoint's
   `maxScore` is an **exploit candidate** worth investigating. This connects the
   seed button to the balance goal instead of being pure authoring sugar — it's
   the poor man's parameter sweep ([05](05-balance-design.md) Phase B) until the
   real one exists. Surface these as warnings only (never a hard fail).

> Phase 5 is genuinely optional. If time-boxed, Phases 1–4 deliver the balance
> verdict (the actual goal); Phase 5 is authoring convenience and can be dropped
> or split to its own PR without affecting 1–4.

### Phase 6 — Goal-pacing envelopes (score / race) (D3)

Generalizes the balance verdict to the two non-timed goals. **Largest new shared
surface in this plan; lands last and is independently droppable** — Phases 1–5
are complete without it (score/race just show the empty state).

1. **New type `PacingEnvelope`** in `shared/src/balance/pacing.ts` — the
   **time-axis mirror** of `TargetEnvelope`. Where `TargetEnvelope` asks "at time
   T, is score in `[minScore, maxScore]`?", `PacingEnvelope` asks "to reach
   milestone M, is the elapsed time in `[minTimeSec, maxTimeSec]`?":

   ```typescript
   interface PacingCheckpoint {
     /** Milestone: a score threshold (target-score) or omitted for race (single goal). */
     readonly atScore?: number
     readonly minTimeSec: number
     readonly maxTimeSec: number
     readonly phase: string
   }
   interface PacingEnvelope {
     readonly mode: GameMode
     readonly goalType: 'target-score' | 'buy-upgrade'
     /** score→time milestones (target-score); a single time band for race. */
     readonly checkpoints: readonly PacingCheckpoint[]
     readonly minViableStrategies: number
     /** Max best/worst *time* ratio among viable strategies (faster = better). */
     readonly maxTimeSpread: number
   }
   ```

2. **`validatePacing(envelope, results): PacingReport`** — mirrors
   `validateEnvelope` on the time axis. A strategy is **viable** if it _reached
   the goal_ (`SimResult.goalReached`) **and** its time-to-milestone lands within
   `[minTimeSec, maxTimeSec]` at the final milestone. "Above `maxTimeSec`" =
   too-slow (buff candidate); "below `minTimeSec`" = suspiciously fast (exploit
   candidate — the time-axis analog of exceeding `maxScore`). A strategy that
   never reached the goal is non-viable, full stop.
   - **Time-to-milestone extraction:** for a score milestone `atScore`, the
     first snapshot whose `score >= atScore` gives the elapsed time; for race,
     the run's final `timeSec` when `goalReached` (the buy tick). Add
     `firstTimeAtScore(result, atScore)` next to `simResultsToScores` in
     `project.ts` (pure, unit-tested).
3. **Author + calibrate** `IDLER_SCORE_ENVELOPE` (and, if idler has a
   `buy-upgrade` goal, `IDLER_RACE_ENVELOPE`) the same way as Phase 2: run the
   corpus at that goal, seed time bands from observed P10/P90, adjust to intent.
   Register them (`'idler:target-score'`, `'idler:buy-upgrade'`). If a goal has
   no meaningful design target yet, **leave it unregistered** rather than ship a
   tautological band — the empty state is the honest default.
4. **Wire the verdict + CI** through the kind-dispatch stubs already added in
   Phases 3 and 4 — no new call sites, just fill in the `PacingEnvelope` branch.
   The chart band (Phase 3b) stays timed-only for now (a time-band overlay on a
   score chart is a different visual; deferred — noted in Out of Scope).
5. **Tests:** `validatePacing` viability/spread/exploit cases with synthetic
   results (`shared/tests`); `firstTimeAtScore` edge cases (exact hit, never
   reached, hit on first tick); the score/race verdict renders in the Queue tab
   (`client/tests`); `check-balance` exercises a registered pacing envelope.

> **Reality check:** the competitive game is time-limited (`ROUND_DURATION_SEC`),
> so **timed is the envelope that guards shipping balance**. Score/race pacing is
> a design/exploration aid (how fast _can_ you reach X). Worth having for
> completeness and future modes, but if calibration reveals no stable design
> target, registering nothing is the correct outcome — not a forced band.

### Phase 7 — Editor-authored envelopes (move out of hardcode)

Phases 1–6 leave the three envelopes **hardcoded** in
[shared/src/modes/idler-envelope.ts](../../shared/src/modes/idler-envelope.ts)
and wired via a static `mode:goalType` map in
[shared/src/balance/registry.ts](../../shared/src/balance/registry.ts). This
phase makes them **authored data** in the mode's tree JSON
([shared/trees/idler.json](../../shared/trees/idler.json)), editable in the
`/dev.html` editor next to resources / generators / attacks. The same JSON that
defines a mode's mechanics now also defines the balance bands the CI gate checks
it against. This is data-plumbing + a UI surface — the envelope _values_ don't
change, and **`check:balance` must produce the identical three PASS verdicts**
before and after (the proof it's behavior-preserving).

**Design decision: envelopes travel with the mode.** A top-level `envelopes`
array in the tree file is decoded into a new `ModeDefinition.envelopes` field
(mirroring `goals`/`generators`/`flavors`). The registry stops importing
constants and **derives** `envelopeFor` / `allEnvelopes` from loaded modes. This
adds no new lifecycle (`loadTree()` already registers the mode before any
lookup; the dev app, server, and `check-balance` all load first) and no runtime
import cycle — `modes/types.ts` gains a **type-only** import of `BalanceEnvelope`
from `balance/types.ts`, and `balance/types.ts` imports nothing from `modes/`,
so the edge stays one-directional. The `mode` field is redundant with the tree
id, so the **JSON omits it** and the codec injects `tree.id`; the interfaces keep
the field (populated by the codec) to avoid churn in `validatePacing`,
`check-balance.ts`, and the UI.

**No version bump.** `envelopes` is added as **optional with `.default([])`**, a
purely additive schema change — a file without it still parses (yields `[]`) and
the checked-in `idler.json` stays `version: 3`, just gaining the array. (The
v1→v2/v2→v3 migrations exist only for _breaking_ structural rewrites; an additive
optional field needs none.)

1. **Schema (`shared/src/tree/schema.ts`).** Add checkpoint leaf schemas
   (`ScoreCheckpointSchema` = `{ timeSec, minScore, maxScore, phase }`;
   `TimeCheckpointSchema` = `{ atScore?, minTimeSec, maxTimeSec, phase }`) and an
   `EnvelopeSchema` discriminated on `goalType` (`timed` → score-band +
   `maxStrategySpread`; `target-score`/`buy-upgrade` → time-band +
   `maxTimeSpread`), with **no** `mode` field. Add
   `envelopes: z.array(EnvelopeSchema).default([])` to `TreeFileSchema`. Keep zod
   to structural checks; ordering / cross-field semantics live in
   `validateModeDefinition` (step 3) to match the existing mode-validation voice.

2. **Codec (`shared/src/tree/codec.ts`).** In `toModeDefinition`, map each
   authored envelope to a `BalanceEnvelope` by injecting `mode: tree.id`, and
   assign to `def.envelopes`. No migration step.

3. **`ModeDefinition` + validation.** Add
   `readonly envelopes: readonly BalanceEnvelope[]` to
   [shared/src/modes/types.ts](../../shared/src/modes/types.ts) (type-only import
   of `BalanceEnvelope`). In `validateModeDefinition`
   ([shared/src/modes/index.ts](../../shared/src/modes/index.ts)) add
   `validateEnvelopes(id, def)`: at most one envelope per `goalType`; the
   `goalType` must exist in `def.goals`; `checkpoints` non-empty and ordered
   (`min ≤ max` per band; score checkpoints ascending by `timeSec`; time
   checkpoints with `atScore` ascending); `target-score` `atScore` ≤ the mode's
   `target-score` goal `target` when such a goal exists; `minViableStrategies ≥ 0`,
   spread ≥ 1. Throw with an `idler: envelope[timed]: …`-style message. Also add
   `getLoadedModeDefinitions(): ModeDefinition[]` (`[...MODE_REGISTRY.values()]`).

4. **Registry derives from modes (`shared/src/balance/registry.ts`).** Drop the
   `idler-envelope.js` import and the static map. `envelopeFor(mode, goalType)` →
   safely look up the loaded mode (return `undefined` if unloaded / no match) and
   `.envelopes.find(e => e.goalType === goalType)`. `allEnvelopes()` →
   `getLoadedModeDefinitions().flatMap(d => d.envelopes)`. Keep `BalanceEnvelope`
   - `isPacingEnvelope` unchanged. **Fail soft** (never throw on an unloaded mode
     — degrade to "no envelope" exactly as an unregistered key does today).

5. **Delete** [shared/src/modes/idler-envelope.ts](../../shared/src/modes/idler-envelope.ts)
   and its `export { IDLER_TIMED_ENVELOPE }` re-export in `modes/index.ts`.

6. **Author the bands into JSON.** Add the `"envelopes"` array to
   `shared/trees/idler.json` with the current calibrated bands verbatim (minus
   `mode`): the `timed` `TargetEnvelope`, the `target-score` and `buy-upgrade`
   `PacingEnvelope`s.

7. **Editor UI (client).** Add pure model helpers to
   `client/src/dev/editor/model.ts` (`listEnvelopes`, `addEnvelope(goalType)`
   seeded with one checkpoint, `removeEnvelope`, `updateEnvelopeScalars`,
   `addCheckpoint`/`removeCheckpoint`/`updateCheckpoint`). Add a new
   `client/src/dev/editor/views/envelopes.ts` `EditorView` (mirrors
   `views/resources.ts`): one block per envelope with a kind-appropriate
   checkpoint table (score-band vs time-band columns) plus the scalar fields;
   "Add envelope" gated to `goalType`s the mode has a goal for and lacks an
   envelope for. Register `{ id: 'envelopes', label: '🎯 Envelopes' }` in
   `client/src/dev/editor/index.ts`. Reuse existing `ed-form-*` classes (no new
   CSS → keeps `lint:css` green). Also clean up the **legacy** dev panel
   `client/src/dev/ui.ts` — drop the `IDLER_TIMED_ENVELOPE` import + local
   `ENVELOPES` map, resolve via `envelopeFor(mode, 'timed')`.
   _(A live envelope-vs-corpus preview inside the editor is a **follow-up** — the
   Queue tab already renders verdicts.)_

8. **Tests + gate.** shared: v3 `idler.json` round-trips envelopes;
   `toModeDefinition` injects `mode`; a file without `envelopes` yields `[]`;
   `validateEnvelopes` rejects out-of-order checkpoints, inverted bands,
   duplicate goalType, an envelope for an absent goal, and `atScore` past the
   score target. Switch `project.test.ts` (and any other importer of the deleted
   constants) to `loadTree` + `envelopeFor`. client: editor model/view unit tests
   for the envelope helpers + add-gating. server: `tree-file.test.ts` still loads
   `idler.json` and `allEnvelopes()` returns 3 post-load. Then the full gate,
   with `check:balance` producing the **same three PASS verdicts**.

> **Scope:** envelope _evaluation_ (`validateEnvelope`/`validatePacing`) and the
> Queue-tab verdict UI are untouched — only the _source_ of the envelope data and
> its editability change. Independently shippable after Phase 6.

---

## Testing Strategy

- **Shared** (`shared/tests/`): _pure_ logic only — projection snapshot-selection
  edge cases (exact / between / past-end checkpoint times), registry hit/miss,
  `validateEnvelope` with synthetic data. No disk I/O (D5).
- **Client** (`client/tests/`): envelope-section rendering (PASS/FAIL/exploit/
  non-timed-empty/short-duration-guard) via DOM assertions; `enumerationToQueue`
  1:1 mapping. (Follow `mode-ui.test.ts` style.)
- **`scripts/check-balance.ts`** is the integration test _and_ the gate: it loads
  the real corpus, runs the real engine, and asserts the real envelope passes. It
  runs in **pre-push** (D5) and in **CI**.
- Full gate before "ready": `pnpm typecheck && pnpm test && pnpm lint &&
pnpm lint:css && pnpm format:check && pnpm check:balance`.

---

## Risks & Mitigations

| Risk                                                           | Mitigation                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Calibration tautology** — bands copied from current output   | Bands express _design intent_; calibration is only a starting suggestion, then adjusted toward intended pacing.             |
| **Corpus isn't diverse** (human recordings, not archetypes)    | Phase 2b curates orthogonal archetypes; viability/spread computed over them. A single-path finding is surfaced, not hidden. |
| **Re-baselining becomes a rubber stamp**                       | Envelope updates are reviewed like snapshot tests; the script prints before/after deltas; justification goes in the PR.     |
| Envelope can't reach `minViableStrategies: 3`                  | Lower to the honest achievable count and document (D4); the gate's value is regression-catching, not a magic number.        |
| CI gate reddens `main` on merge                                | Calibrate + assert PASS locally in Phase 2 **before** wiring the hard CI step (D4).                                         |
| **Short-duration run → spurious envelope FAIL**                | Duration guard in Phase 3: only evaluate when `runDurationSec >= lastCheckpoint.timeSec`, else show a notice.               |
| **`fs` leaking into `shared/src`** breaks the browser bundle   | Node loader stays under `scripts/`; shared stays `fs`-free (D5).                                                            |
| Perfect==delayed hides real skill-variance failures            | Explicit caption in the report + a named follow-up to add `highlightDelaySec` to `SimulateOptions` (D1).                    |
| Projection drift between dev panel and CI                      | Single shared `simResultsToScores`; both callers import it (Phase 1).                                                       |
| Envelope only checks _known_ strategies (no exploit discovery) | Named as out-of-scope; Phase 5's enumeration pass is a cheap partial adversary; real sweep is future work.                  |
| **Pacing envelope has no stable design target** (score/race)   | Phase 6 registers _nothing_ for that goal rather than a tautological band; the empty state is the honest default.           |
| Reference strategies change and silently break the envelope    | `pnpm check:balance` fails fast in pre-push, before CI.                                                                     |

---

## Where This System Goes Next (designed to grow)

This plan delivers the _spine_ (verdict + gate + corpus). To become a
professional balancing system that actively makes the game more fun, the
following levers build on it — named here so the code is shaped to accept them,
not retrofitted:

- **Decision-diversity index** ([05](05-balance-design.md) Layer 4). Beyond "N
  viable," measure how _orthogonal_ the viable strategies are (share ≤ 50% of
  purchases → orthogonal; target ≥ 40% of pairs). This is the metric that most
  directly correlates with "meaningful choices." The corpus from Phase 2b is its
  input.
- **Build-variety / mandatory-upgrade detection.** If one upgrade appears in
  100% of viable strategies, it's either mandatory (boring) or overpowered
  (auto-include). Flag it. Cheap to compute from the same runs.
- **Engagement metrics.** Time-to-first-purchase, longest idle gap, actions/min —
  a mode that scores fine but has a dead first 10s is still unfun.
- **Real skill-variance** (`highlightDelaySec` — D1 follow-up) so the delayed
  variant is a genuine second data point, restoring the both-variants viability
  test [05](05-balance-design.md) Layer 5 intends.
- **Adversarial search** ([05](05-balance-design.md) Phase B parameter sweep) to
  find exploits no one authored — the envelope's biggest blind spot.
- **Multi-goal + multi-mode coverage.** The registry + CI already iterate
  generically; adding a mode/goal is "author an envelope + a corpus," zero script
  changes.
- **Balance dashboard** ([05](05-balance-design.md) Phase D) once ≥ 2 modes
  exist: red/yellow/green health per checkpoint, diversity index, historical
  tracking of git-committed snapshots.

---

## Relationship to Prior Plans

- **Completes** [23-timeline-strategy-simulation.md](23-timeline-strategy-simulation.md)
  **Phase 5** ("Envelope integration (overlay + report reuse) and optional
  `generateStrategies`-as-seed button"). The overlay lands **in full** — both the
  report table (Phase 3) and the shaded score-chart band (Phase 3b, D2) —
  alongside the seed button (Phase 5).
- **Closes** [05-balance-design.md](05-balance-design.md) **Phase A.4** (envelope
  in the dev panel — table **and** shaded band) and **Phase C** (extract engine —
  _done_ by plan 23 — plus `scripts/check-balance.ts` CI gate). Phase A.5 (manual
  idler tuning) is folded into this plan's Phase 2 calibration to the extent
  needed to make the envelope pass. Extends the framework to non-timed goals
  (Phase 6, D3) beyond what [05](05-balance-design.md) originally scoped.

## Out of Scope (named, not forgotten)

- **Delayed-timing / skill-variance modeling** (`highlightDelaySec` in the shared
  engine) — D1 follow-up; until then the report is perfect-timing only.
- **Time-band overlay on the chart for score/race pacing** — the Phase 3b band is
  timed-only (score-axis chart); a pacing band is a different visual, deferred.
- **Parameter-sweep tool** ([05](05-balance-design.md) Phase B) and the
  **balance dashboard** (Phase D) — separate, larger efforts.
- **The growth levers** in [Where This System Goes Next](#where-this-system-goes-next-designed-to-grow)
  (diversity index, mandatory-upgrade detection, engagement metrics, adversarial
  search) — explicitly future, but the code here is shaped to accept them.
