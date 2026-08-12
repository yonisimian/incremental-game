# 30 — Highlight battery

## Status: Draft

---

## Goal

Give the highlight mechanic a **resource cost over time**, so highlighting stops
being a free permanent choice and becomes a rhythm the player manages.

The mechanic:

1. An upgrade unlocks a **battery** — a horizontal bar shown above the highlight
   selector cards.
2. The battery **charges while nothing is highlighted** and **drains while a
   resource is highlighted**.
3. While `charge > 0`, the highlight's factor is **multiplied by the battery
   factor**. At empty, the battery multiplier snaps back to `1×` and the highlight
   keeps only its own base factor.
4. Further upgrades raise the battery factor, its max capacity, its charge speed,
   and lower its drain speed; two mutually-exclusive picks reshape the
   charge→power response curve.

The 7 upgrade nodes for this already exist in the idler tree as **layout-only
placeholders** (`shb-unlock` … `shb-lcp`) — ids, offsets, prerequisites, purchase
limits, and a `battery-choice` choiceGroup, but **no costs and no effects at
all**. This plan wires them up.

The prerequisite that makes the whole thing possible is unglamorous and comes
first: **today it is impossible to have nothing highlighted.**

---

## What already exists (verified)

| Piece                        | State                                                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The 7 tree nodes             | [idler.json:1727-1820](../../shared/trees/idler.json#L1727-L1820) — layout, prereqs, `purchaseLimit`, `choiceGroup: "battery-choice"` on `shb-hcp`/`shb-lcp`. Every node has `"cost": {}` and **no `effects`**. |
| Their flavor                 | [idler.json:434-474](../../shared/trees/idler.json#L434-L474) — placeholders: `name` is the raw id, all 🔎, descriptions are one-liners.                                                                        |
| `highlightMultiplier` effect | [highlight-multiplier.ts](../../shared/src/effects/seed/highlight-multiplier.ts) — multiplicative `baseModifier` on `meta.highlight`, defaulting to `'r0'`.                                                     |
| Highlight unlock gate        | `systemUnlock {system:'highlight'}` → [`isHighlightActive`](../../shared/src/modes/index.ts#L523). Gate index + `anyOwned` in [unlock-gates.ts](../../shared/src/unlock-gates.ts).                              |
| Display factor               | [`getHighlightMultiplier`](../../shared/src/modes/index.ts#L535) — scans `highlightMultiplier` refs only, compounds `^ owned`.                                                                                  |
| Time substrate               | `meta.gameSec` advances in [`applyPassiveTick`](../../shared/src/modifiers/pipeline.ts#L147) — the **single** entry point shared by the server ([match.ts:503](../../server/src/match.ts#L503)) and the sim.    |
| Param-collection precedent   | [`collectGeneratorCostFactors`](../../shared/src/generators.ts#L46) — collect an effect output kind across owned upgrades, fold owned-count compounding.                                                        |
| Wire                         | Own full `PlayerState` **including `meta`** is broadcast every `BROADCAST_INTERVAL_MS = 500`. Battery state in `meta` needs **no protocol change**.                                                             |
| Highlight UI                 | Selector cards injected/removed on the gate flip at [play-panel.ts:133-160](../../client/src/ui/panels/play-panel.ts#L133-L160); Tab cycling at [hotkeys.ts:115-119](../../client/src/ui/hotkeys.ts#L115-L119). |
| Highlight telemetry          | Dwell-per-resource in [round-stats.ts:79-91](../../client/src/stats/round-stats.ts#L79-L91); Highlight section in [data-panel.ts:162-188](../../client/src/ui/panels/data-panel.ts#L162-L188).                  |
| Editor                       | [effects-editor.ts:377](../../client/src/dev/editor/effects-editor.ts#L377) builds forms from `listEffectTypes()` + the zod schema. **A new effect appears automatically** — nothing to hand-register.          |
| Sim gate handling            | [metrics.ts:191](../../shared/src/balance/metrics.ts#L191) already treats `systemUnlock` as a sim-reachability gate, so a new system reuses that for free.                                                      |

### The two structural gaps

**1. "Nothing highlighted" is unrepresentable end to end.** Not a UI omission — a
data-model one:

- `initialMeta.highlight` is `"r0"` ([idler.json:15](../../shared/trees/idler.json#L15)),
  and [modes/index.ts:126](../../shared/src/modes/index.ts#L126) _requires_ the key
  when `highlightEnabled`.
- `highlightMultiplier.apply` does `?? 'r0'` — with no highlight it silently
  boosts `r0` anyway.
- Every **writer** validates `resources.includes(highlight)`, so "none" is
  rejected: [match.ts:423-428](../../server/src/match.ts#L423-L428),
  [match.ts:484-489](../../server/src/match.ts#L484-L489) (bot),
  [apply.ts:61-65](../../shared/src/simulation/apply.ts#L61-L65),
  [strategy.ts:171-173](../../shared/src/simulation/strategy.ts#L171-L173),
  [game.ts:728-731](../../client/src/game.ts#L728-L731) (reconcile).
- Every **reader** defaults to a resource: [play-panel.ts:20](../../client/src/ui/panels/play-panel.ts#L20),
  [round-stats.ts:89](../../client/src/stats/round-stats.ts#L89),
  [data-panel.ts:259](../../client/src/ui/panels/data-panel.ts#L259), Tab cycling.

**2. Nothing in the engine is time-integrated.** Every effect today is a pure
`state → output` function. The battery is an **integrator**:

```text
charge ← clamp(charge + (highlighted ? −drainRate : +chargeRate) · dt, 0, maxCharge)
```

The only code that mutates state over time is `applyPassiveTick` (advance
`gameSec`, credit resources). So the battery needs a genuinely new thing: a
per-tick state advance driven by effect-collected parameters.

---

## Design decisions (answered)

| Question              | Answer                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gate or scale?**    | **Gate.** Highlight always gives its own base factor. The battery multiplies it **while `charge > 0`**; at empty the battery multiplier is exactly `1×` (a hard snap). |
| **Starting charge**   | **Half of `maxCharge`** — seeded at the moment the battery unlocks, not at round start.                                                                                |
| **Drain vs capacity** | **Independent.** `maxCharge` buys _duration_, `drainRate` buys _efficiency_. Otherwise `shb-mc` and `shb-mf-ds` would be the same upgrade.                             |

Consequences worth stating:

- The snap at empty is intentionally harsh — it's the feedback that teaches the
  rhythm. The **curve** upgrades (`shb-hcp`/`shb-lcp`) shape how much of the bonus
  you get _above_ empty; they never change the fact that empty means `1×`.
- Seeding at unlock (rather than round start) keeps `initialMeta` untouched and
  means no boot-validation rule is owed. `meta.hlCharge` simply does not exist
  until the battery is unlocked.

---

## Data model

### New shared module: `shared/src/highlight-battery.ts`

Owns the parameter shape, the defaults, the curve functions, the integrator, and
the derived factor. One module so the server, the sim, and the client read the
same math.

```ts
/** Charge→power response shape. */
export type BatteryCurve = 'linear' | 'highWeighted' | 'lowWeighted'

/** The battery's fully-resolved parameters for one player. */
export interface BatteryParams {
  /** Peak multiplier applied on top of the highlight factor (at full response). */
  factor: number
  /** Capacity, in charge units (1 unit = 1 second of drain at drainRate 1). */
  maxCharge: number
  /** Units gained per second while nothing is highlighted. */
  chargeRate: number
  /** Units lost per second while a resource is highlighted. */
  drainRate: number
  curve: BatteryCurve
}

export const BATTERY_DEFAULTS: Readonly<BatteryParams> = {
  factor: 1.5,
  maxCharge: 20,
  chargeRate: 1,
  drainRate: 1,
  curve: 'linear',
}
```

**Why defaults in code rather than authored on `shb-unlock`?** It keeps the
unlock node to a single `systemUnlock` ref and keeps the "battery exists at all"
question separate from "how strong is it". If tuning later wants the baselines
editor-visible, they move to authored `batteryStat` refs on `shb-unlock` with no
change to any consumer — call that out as the escape hatch rather than building
for it now.

### New effect: `batteryStat`

`shared/src/effects/seed/battery-stat.ts`, registered in
[effects/index.ts](../../shared/src/effects/index.ts).

```ts
const schema = z.strictObject({
  stat: z.enum(['factor', 'maxCharge', 'chargeRate', 'drainRate']),
  op: z.enum(['add', 'mult']),
  value: z.number(),
})
```

One parameterized effect rather than four near-identical ones: one closed enum
(so an authored typo refuses to boot), one auto-generated editor form, one place
to fold owned-count compounding. The `stat` enum is the complexity being added
and it is the smaller of the two options.

New output kind in [effects/types.ts](../../shared/src/effects/types.ts):

```ts
export interface BatteryStatOutput {
  readonly kind: 'batteryStat'
  readonly stat: 'factor' | 'maxCharge' | 'chargeRate' | 'drainRate'
  readonly op: 'add' | 'mult'
  readonly value: number
}
```

Per the kind-routing convention, every existing consumer ignores it —
`collectModifiers`, `collectGeneratorCostFactors`, and the unlock gates need no
change to _tolerate_ it.

### Curve authoring

`shb-hcp` / `shb-lcp` set the response shape. Either a `curve` field on
`batteryStat` (making `stat`/`op`/`value` optional-ish, which muddies the schema)
or a sibling one-field effect:

```ts
// batteryCurve — preferred: keeps batteryStat's schema strict
const schema = z.strictObject({ curve: z.enum(['linear', 'highWeighted', 'lowWeighted']) })
```

Recommend **`batteryCurve` as its own effect**. Two tiny strict schemas beat one
schema with mutually-exclusive fields, and it reads better in the editor. The two
nodes are already mutually exclusive via `choiceGroup: "battery-choice"`, so
nothing needs to resolve a conflict — but the collector should still be
deterministic (last-declared wins) rather than order-dependent-by-accident.

### Collection

```ts
export function collectBatteryParams(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): BatteryParams
```

Mirrors `collectGeneratorCostFactors`: walk mode-level then owned upgrade-level
refs, fold with owned-count compounding — `add → value × owned`,
`mult → value ** owned` — starting from `BATTERY_DEFAULTS`. All `add`s before all
`mult`s, per stat, so the result is independent of authoring order. Clamp the
result to sane floors (`maxCharge > 0`, rates `>= 0`, `factor >= 1`) so a
mis-authored negative can't invert the mechanic.

### Runtime state

`meta.hlCharge: number | undefined` — absent until the battery unlocks. Read with
the same `as number | undefined` idiom `gameSec` and `peakCps` already use. Rides
the existing broadcast; **no wire change**.

`meta.highlight` becomes `string | null` (currently always a `string`).

---

## The integrator

```ts
export function advanceHighlightBattery(
  state: PlayerState,
  mode: ModeDefinition,
  tickSec: number,
): void
```

- No-op unless `isHighlightBatteryActive(state, mode)`.
- Seed `meta.hlCharge = maxCharge / 2` when absent (the unlock moment).
- `highlighted = readHighlight(state) !== null`, then integrate and clamp to
  `[0, maxCharge]`.
- NaN-guard: a non-finite result resets to `0` rather than poisoning `meta`.
- A `maxCharge` **reduction** (only reachable via a mis-authored `mult < 1`) must
  clamp the stored charge down, not leave it over cap.

Called from [`applyPassiveTick`](../../shared/src/modifiers/pipeline.ts#L147),
immediately after `meta.gameSec` advances and **before** rates are computed — so
the charge the factor reads is this tick's charge. That single call site gives the
server ([match.ts:503](../../server/src/match.ts#L503)) and the balance sim
identical behavior with no duplicated math.

> ⚠️ `pipeline.ts` currently imports nothing from `modes/`. Collecting params
> needs the mode, which it already receives indirectly — check the import
> direction when implementing; if it would create a cycle, pass the resolved
> `BatteryParams` into `applyPassiveTick` from its two callers instead.

---

## The factor

```ts
export function batteryFactor(state: Readonly<PlayerState>, mode: ModeDefinition): number
```

`charge <= 0` → `1`. Otherwise `1 + (factor − 1) · f(charge / maxCharge)` where
`f` is:

| curve          | `f(x)`    | effect                                              |
| -------------- | --------- | --------------------------------------------------- |
| `linear`       | `x`       | payoff proportional to charge                       |
| `highWeighted` | `x²`      | most of the bonus only near full — burst play       |
| `lowWeighted`  | `sqrt(x)` | near-peak bonus almost immediately — sustained play |

Applied as a **mode-level** effect emitting a multiplicative `baseModifier` on the
currently-highlighted resource — mode-level specifically because
[`routeBaseModifier`](../../shared/src/modes/index.ts#L714) compounds
`value ** owned`, and the params are **already folded** by `collectBatteryParams`.
An upgrade-level ref would compound `shb-bp`'s contribution twice.

`getHighlightMultiplier` ([modes/index.ts:535](../../shared/src/modes/index.ts#L535))
only scans `highlightMultiplier` refs today, so it must fold the battery in or the
data panel under-reports the real factor.

**Why not `relativeModifier` with a `meta:hlCharge` source?** Its `field` is a
static authored string; the target here is _whichever_ resource is highlighted.
Not expressible.

---

## Client

### The bar

Horizontal bar above the selector cards in
[play-panel.ts](../../client/src/ui/panels/play-panel.ts), injected/removed on the
`isHighlightBatteryActive` flip using the exact inject/remove pattern the
highlight cards and click cards already use at
[:133-160](../../client/src/ui/panels/play-panel.ts#L133-L160). Fill width from
`charge / maxCharge`; a state class for charging / draining / empty. CSS in
`client/src/styles` (`lint:css` is enforced); watch the 60/80 kB bundle budget.

### Local extrapolation (required, not polish)

The client **never integrates income locally** —
[playing.ts:44-52](../../client/src/ui/playing.ts#L44-L52) only _displays_ rates,
and resources arrive on `STATE_UPDATE` every 500 ms. A bar driven straight off
snapshots steps in 500 ms jumps, which for a continuously-moving meter reads as
broken.

So: hold `{ charge, atMs }` from the last snapshot, extrapolate each frame using
the **locally-predicted** highlight state and the collected params, and resnap on
every `STATE_UPDATE`. This is display-only extrapolation — it never feeds a
purchase decision, so it stays outside the `ackSeq` replay path at
[game.ts:728](../../client/src/game.ts#L728) (which does need to replay the
highlight _clear_).

### Releasing the highlight

- Clicking the already-highlighted card clears it ([game.ts:451-462](../../client/src/game.ts#L451-L462)).
- Tab cycling gains a "none" stop ([hotkeys.ts:115-119](../../client/src/ui/hotkeys.ts#L115-L119)).
- No card carries the `highlighted` class while released.

### Data panel

- New Battery block: charge / max, live factor, net rate, time-to-full and
  time-to-empty.
- Fold the battery into the existing `data-hl-mult` readout
  ([data-panel.ts:268](../../client/src/ui/panels/data-panel.ts#L268)).
- Report it in the dynamic-upgrades section added in `204f86c` — a charge-scaled
  multiplier is precisely what that section exists to show.
- `Current: —` when nothing is highlighted; dwell gains a no-highlight bucket.

---

## Bot

[bot.ts:243](../../server/src/bot.ts#L243) pins a farm highlight unconditionally,
so post-battery the bot sits permanently at empty charge — it would _lose_ ground
to the mechanic. Give it a release-when-drained / re-highlight-when-charged cycle.
The bot's ideal duty cycle is a balance question; a simple hysteresis (release at
0, re-highlight at some fraction of max) is enough for v1.

---

## Simulator

Strategies cannot express "release the highlight" today
([strategy.ts:50](../../shared/src/simulation/strategy.ts#L50) requires a resource
string), so **without this the battery cannot be tuned at all**. It lands early
(commit 3), before any costs are authored.

`set_highlight` takes `string | null` end to end: schema + validation
([strategy.ts:171-173](../../shared/src/simulation/strategy.ts#L171-L173)), label
([simulate.ts:158](../../shared/src/simulation/simulate.ts#L158)), live-export
round-trip ([live-export.ts:97](../../shared/src/simulation/live-export.ts#L97)),
and the dev panel's queue model.

Also owed: [balance/validate.ts](../../shared/src/balance/validate.ts)'s
perfect-vs-delayed highlight-timing comparison becomes battery-dependent — a
"delayed switch" now also means a differently-charged battery. Revisit its
interpretation in the tuning commit rather than silently keeping a verdict that no
longer means what it did.

---

## Testing

| Area                                                                            | What                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `shared/tests/highlight-battery.test.ts`                                    | Integrator: clamps at `0` and `maxCharge`; drains only while highlighted; charges only while released; seeds at half on unlock; inert while locked; non-finite reset; `maxCharge` shrink clamps stored charge. |
| Same file                                                                       | `batteryFactor`: `1×` at empty; peak at full; each curve's midpoint ordering (`lowWeighted` > `linear` > `highWeighted` at `x = 0.5`).                                                                         |
| [effects.test.ts](../../shared/tests/effects.test.ts)                           | `batteryStat` / `batteryCurve` param folding across multiple owned levels; add-then-mult ordering; floors clamp a negative.                                                                                    |
| [highlight-multiplier.test.ts](../../shared/tests/highlight-multiplier.test.ts) | No highlight → no modifier (was: silently boosted `r0`).                                                                                                                                                       |
| [rate-breakdown.test.ts](../../shared/tests/rate-breakdown.test.ts)             | Buckets still telescope to the authoritative total with the battery active, charged and empty.                                                                                                                 |
| [modes.test.ts](../../shared/tests/modes.test.ts)                               | `highlightEnabled` + `initialMeta.highlight: null` boots; unknown `stat`/`curve` refuses to boot.                                                                                                              |
| [simulation.test.ts](../../shared/tests/simulation.test.ts) / live-export       | Null highlight round-trips through strategy → sim → export.                                                                                                                                                    |
| [match.test.ts](../../server/tests/match.test.ts)                               | Server accepts a null highlight; charge advances across ticks; charge is in the broadcast.                                                                                                                     |
| [bot.test.ts](../../server/tests/bot.test.ts)                                   | Bot releases at empty and re-highlights once charged.                                                                                                                                                          |
| [game.test.ts](../../client/tests/game.test.ts)                                 | Toggle-off prediction; the clear survives reconciliation.                                                                                                                                                      |
| [round-stats.test.ts](../../client/tests/round-stats.test.ts)                   | No-highlight dwell bucket.                                                                                                                                                                                     |
| [components.test.ts](../../client/tests/components.test.ts)                     | Bar appears on the gate flip, disappears when locked, width tracks charge.                                                                                                                                     |

---

## Implementation order

Phased so each commit is independently green
(`typecheck && format:check && lint && lint:css` + tests) and the mechanic only
becomes player-visible at commit 10.

**Phase A — make "nothing highlighted" real** (worth shipping even if the battery
slips; it's a coherent mechanic on its own)

1. `refactor(highlight): treat "nothing highlighted" as a first-class state`
   Shared engine only, before anything can produce `null`: drop
   `highlightMultiplier`'s `?? 'r0'`; accept null in
   [apply.ts:61-65](../../shared/src/simulation/apply.ts#L61-L65); relax the
   `initialMeta` rule at [modes/index.ts:126](../../shared/src/modes/index.ts#L126);
   add a `readHighlight(state)` helper so the `as string | undefined` cast lives in
   one place instead of six. Tests: highlight-multiplier, modes.

2. `feat(highlight): let players release the highlight`
   Writers + UI affordance: [match.ts:423-428](../../server/src/match.ts#L423-L428)
   and the identical bot path at
   [:484-489](../../server/src/match.ts#L484-L489); toggle-off in
   [game.ts:451-462](../../client/src/game.ts#L451-L462) + replay at
   [:728-731](../../client/src/game.ts#L728-L731); Tab "none" stop; `play-panel`
   class toggle; no-highlight dwell bucket; data-panel `—`. Tests: game,
   round-stats, match.

3. `feat(sim): release-highlight action for queue strategies`
   `set_highlight: string | null` through strategy schema/validation, sim label,
   live-export, dev queue model. Lands **before** any tuning so the balance panel
   can exercise the battery later. Tests: simulation, live-export, queue-model.

**Phase B — engine** (no player-visible change; 4 → 5 → 6 → 7 → 8 in order,
6 depends on 4+5, 7 depends on 6)

4. `feat(effects): batteryStat effect and battery param collection`
   New `shared/src/highlight-battery.ts` with `BatteryParams` +
   `BATTERY_DEFAULTS`; `batteryStat` effect + `BatteryStatOutput` kind;
   `collectBatteryParams` with owned-count folding and floors. No behavior yet.
   Tests: effects.

5. `feat(highlight): unlock gate for the highlight battery`
   Add `'highlightBattery'` to `UNLOCKABLE_SYSTEMS`
   ([system-unlock.ts:6](../../shared/src/effects/seed/system-unlock.ts#L6)) and
   `isHighlightBatteryActive` beside
   [`isHighlightActive`](../../shared/src/modes/index.ts#L523). **Note the
   inversion:** `isSystemUnlocked` treats "no gate → always on"; the battery must
   be **hidden by default**, so use `anyOwned(state, systemGateUpgrades(mode, 'highlightBattery'))`
   directly. Free: `metrics.ts` already treats `systemUnlock` as a sim gate.

6. `feat(highlight): integrate battery charge each tick`
   `advanceHighlightBattery` + the `applyPassiveTick` call site (watch the
   `pipeline.ts → modes/` import direction). Seeds at half max on unlock. Tests:
   new highlight-battery suite, match.

7. `feat(highlight): apply the battery factor while charged`
   Mode-level multiplicative `baseModifier` on the highlighted resource, gated on
   `charge > 0`; fold the battery into `getHighlightMultiplier`. Tests:
   rate-breakdown, highlight-battery.

8. `feat(effects): charge-response curves for the battery factor`
   `batteryCurve` effect + the three `f(x)` shapes + collector wiring. Tests:
   effects, highlight-battery.

**Phase C — turn it on**

9. `feat(idler): wire the highlight battery upgrades`
   Must come after Phase B or `validateModeDefinition` throws at boot on an
   unknown effect type. Effects onto all 7 nodes; real costs (flat for the three
   `purchaseLimit: 1` nodes — [schema.ts:181-193](../../shared/src/tree/schema.ts#L181-L193)
   forbids scaling there — scaled for the four repeatables); real flavor
   names/icons/descriptions replacing the 7 placeholders. Author via `/dev.html`,
   not by hand.

10. `feat(ui): highlight battery bar`
    Play-panel bar with gate-flip inject/remove, CSS, and the local extrapolation
    described above. **This is the commit that makes the mechanic visible.**
    Tests: components.

11. `feat(data-panel): report the highlight battery`
    Battery block, battery folded into `data-hl-mult`, entry in the
    dynamic-upgrades section.

12. `feat(bot): release the highlight to recharge`
    Otherwise the bot permanently sits at empty charge. Tests: bot.

13. `chore(balance): tune battery costs and rates`
    Dev-sim pass on factor / capacity / rates / costs, using commit 3's release
    action. Also reinterpret `balance/validate.ts`'s perfect-vs-delayed highlight
    comparison, which is now battery-dependent.

---

## Open questions

**Q1 — Does the battery drain while highlighting is _unlocked but the round is
paused_?** No: integration happens in `applyPassiveTick`, which the paused tick
loop skips ([match.ts:351](../../server/src/match.ts#L351)), so charge freezes with
game time. Stated for the record; matches `gameSec` semantics and needs no code.

**Q2 — Batch-window granularity.** Highlight actions are applied when their batch
arrives, not at their authored timestamps, while charge integrates per 250 ms
tick. A player who releases and re-highlights inside one 500 ms batch is charged
drain for the whole window. That's conservative (never in the player's favor), so
v1 accepts it — but it means very fast toggling is slightly punished rather than
slightly rewarded.

**Q3 — Should `maxCharge` be expressed in seconds instead of units?** With
`drainRate: 1` they coincide, which is why the defaults are set that way. Units is
the more honest model once `drainRate` moves, but "20 seconds of highlight" is the
number a player actually reasons about. Display concern only — the data panel's
time-to-empty covers it. Flagging in case the flavor text wants to promise
seconds.

**Q4 — Curve choice permanence.** `battery-choice` makes `shb-hcp`/`shb-lcp`
mutually exclusive and permanent for the round. Given `highWeighted` favors burst
play and `lowWeighted` favors sustained play, the pick interacts with click-heavy
vs idle strategies — worth checking in the sim that neither strictly dominates
before the costs are frozen.

**Q5 — Should the factor apply to click income too?** No. The battery multiplies
the **highlight** factor, and highlight is a passive-rate mechanic. Deliberately
out of scope, not rejected.

---

## Deferred

- **Authored baselines.** `BATTERY_DEFAULTS` in code rather than on
  `shb-unlock`. Moving them to authored `batteryStat` refs is additive and touches
  no consumer.
- **Overcharge / burst spend.** No "dump the whole battery for a short massive
  spike" mechanic. The curve upgrades are the only shape control in v1.
- **Opponent visibility.** The opponent's battery is not intel. `accessEnemyData`
  keys are resource-shaped ([access-enemy-data.ts](../../shared/src/effects/seed/access-enemy-data.ts));
  exposing a meta scalar would need a new non-resource intel key like `peakCps`
  has.
- **A second battery-like system.** The integrator is written for the highlight
  battery specifically. If a second charge-based mechanic appears, generalize
  then — not now.
