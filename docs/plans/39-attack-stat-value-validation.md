# 39 — Validating an `attackStat` value

## Status: Implemented

Sections below are the plan as built; where the implementation departed from the
draft, the change and its reason are marked inline.

Follow-up to [36 — attack stat upgrades](36-attack-stat-upgrades.md), which
shipped `value: z.number()` and justified the absence of a guard by pointing at
the collector's floors. The floors do stop an _inversion_. They do not stop a
no-op, a parity flip, or an overflow — and all three were authorable.

**Departures from the draft:**

- **A `NaN` param resolves to the neutral multiplier, not to a bound.** The
  draft mapped every non-finite product to the ceiling. `±Infinity` still clamps
  that way, but `NaN` (the `Infinity × 0` case) resolves to `1`: these are
  multipliers on authored values, so "as authored" is the one reading that
  neither gifts the attacker a free strike (the floor, on `prepareCost`) nor
  deletes the attack (the ceiling).
- **An option repair now mirrors the value it invalidated.** Not in the draft,
  and the editor is wrong without it: snapping `stat` from `prepareCost` to
  `power` leaves a ×0.5 the schema rejects, so the edit silently fails to save
  and the form shows a stat the tree does not have. `repairGuardedValue` mirrors
  the number instead (`mult` inverts, `add`/`offset` negate — the same-sized
  change the other way), and only when the block no longer parses.
- **The candidate ladder needed a fourth value and a second pass.** `-0.5` for
  the "must shrink" guards (`enemyProductionModifier`'s additive debuff), and an
  include-the-optionals pass for a schema that requires at least one of a set of
  optional fields. The new drift guard found `enemyCostModifier` as a second
  pre-existing instance of the seeding bug, alongside `balancedGenerators`.
- **`guardScaledStatValue(label, directions)`** takes the direction _table_, not
  a lookup function — the effect owns the table, the guard owns the arithmetic.
- **Three `attacks.test.ts` fixtures had to go.** `a0-power-negative`,
  `a0-power-half` and `a0-slower` were mis-authored-on-purpose refs, and the
  schema now rejects all three at `applyEffect`. The clamp cases they covered are
  re-expressed through _stacking_ (two individually-legal reductions crossing
  zero), which is what the collector's floor is actually for now.

---

## Goal

Make every `attackStat` `value` that reaches `collectAttackParams` one an author
could have _meant_, and make the resolved params provably finite. Three layers,
each catching what the layer below structurally cannot.

This is an **authoring** guard, not anti-cheat: trees are shipped assets and the
server never parses a player-supplied effect ref. It constrains a value's
_sign_ — an upgrade-hosted stat must help its owner, the rule `baseModifier`
already lives by — and never its _magnitude_, which is balance (see [What this
deliberately does not do](#what-this-deliberately-does-not-do)).

---

## What is wrong today (each verified against the code)

The resolution formula is
[attacks.ts:175-180](../../shared/src/attacks.ts#L175-L180):

```text
resolved[stat] = max(floor, (1 + Σ value·owned) · Π value^owned)   // adds, then mults
```

with `ATTACK_PARAM_FLOORS` all `0`. Against that:

1. **No-ops pass.** `add: 0`, `mult: 1`, `offset: 0` resolve to exactly the
   authored numbers. The upgrade costs a player resources and changes nothing —
   and nothing says so: `renderStats`
   ([attack-panel.ts:72-82](../../client/src/ui/panels/attack-panel.ts#L72-L82))
   prints its line only when `power !== 1` or the delay moved, so a no-op node is
   indistinguishable on the card from a node with no stat at all. Boot is silent,
   the editor preview reads `10s → 10s`, and the bug surfaces as "this upgrade
   feels dead" during playtesting.

2. **`mult: 0` is absorbing, and the floor _is_ `0`.** One such ref collapses the
   stat for every owned count, and no other upgrade can recover it — `(1 + adds) · 0`
   is `0` however many adds stack. That reads as `power: 0` (the attack does
   nothing), `prepareCost: 0` (free forever) or `prepareTime: 0` (instant). The
   clamp cannot catch it because `0` is precisely the value the clamp clamps
   _to_.

3. **A negative `mult` flips by owned parity.** `mult: -2` gives `-2` at one copy
   (clamped to `0`, inert) and `+4` at two (a quadruple). An upgrade whose second
   purchase undoes its first is incoherent under any reading, and today it loads.

4. **`add ≤ -1` zeroes at the first level.** `1 + (-1)·1 = 0`; anything below
   `-1` goes negative and is clamped to the floor. `add: -1.5` reads as "−150%
   cost" and silently means "free". Even a legal negative `add` dies eventually:
   it crosses zero at `owned = 1/|value|`, so `add: -0.2` on an upgrade with
   `purchaseLimit: 8` has three purchasable levels that do nothing — and the last
   three cost the most.

5. **A finite authored value can resolve to a non-finite param, and `NaN` from
   there.** `mult: 1e200` at two owned copies is `Infinity`, and `Math.max`
   passes `Infinity` straight through the floor. Most consumers saturate
   harmlessly (a steal caps at the victim's holdings and at `MAX_STEAL_FRACTION`,
   a debuff at `MIN_DEBUFF_FACTOR`, a cost simply becomes unaffordable). Two do
   not, both because `Infinity × 0` is `NaN`:

   - `getAttackPrepareTimeSec` computes `(def.prepareTimeSec ?? 0) * params.prepareTime`,
     and an active attack **may author `prepareTimeSec: 0`**
     (`z.number().min(0).optional()`, [tree/schema.ts:91](../../shared/src/tree/schema.ts#L91)).
     A `NaN` `readyAtSec` never satisfies `dueAttacks`' `readyAtSec <= gameSec`,
     so the pending entry is immortal and `already-preparing` blocks that attack
     for the rest of the round.
   - `scaleCostFactor` computes `Math.max(1, 1 + (factor - 1) * power)`, and
     `enemyCostModifier` authors `costFactor` as `z.number().min(1)` — so an
     authored `1` against an infinite `power` is `1 + 0 × Infinity` = `NaN`,
     which `Math.max` propagates into the victim's prices.

   Layer 1's direction rule closes the first (a `prepareTime` multiplier can no
   longer exceed `1`, let alone overflow) but not the second, since `power` is
   the one stat that legitimately grows without bound.

6. **A stat can be authored against a number the attack does not have.** A
   `prepareTime` `mult` aimed at an attack with `prepareTimeSec: 0`, or a
   `prepareCost` `mult` aimed at an attack with no `prepareCost`, is arithmetic
   on nothing. Plan 36's boot check rejects a stat aimed at the wrong _kind_ of
   attack; it does not ask whether the named attack has that field.

7. **Nothing asks which direction helps.** `mult: 2` on `prepareTime` makes your
   own strike twice as slow; `offset: +2` adds two seconds per owned level;
   `mult: 0.5` on `power` halves your own magnitude. All three are purchasable
   self-nerfs, and all three load. That is out of step with every other
   upgrade-hosted effect in the seed: `baseModifier` is guarded
   `guardModifierValue('bonus', …)`, `enemyProductionModifier` is guarded
   `'debuff'`, and `relativeModifier`'s `factor > 0` bound is documented as
   holding precisely "so a positive factor is always a meaningful bonus". The
   codebase's standing convention is **an upgrade-hosted effect helps its
   owner**, enforced in the schema wherever the schema can see it.

---

## Approach

### Layer 1 — the schema: the stat's helpful direction

What can be judged from `stat` + `op` alone, with no attack and no host in hand.
This is the `guardModifierValue` analogue: that guard knows the modifier
_stage_'s neutral point and an authored `intent`; this one knows the op's neutral
point and **which way the stat helps its owner**, which is a property of the stat
rather than something each ref declares.

| stat          | helps by   | `add`             | `mult`            | `offset`          |
| ------------- | ---------- | ----------------- | ----------------- | ----------------- |
| `power`       | increasing | `> 0`             | `> 1`             | — (illegal op)    |
| `prepareCost` | decreasing | `< 0` and `> -1`  | `> 0` and `< 1`   | — (illegal op)    |
| `prepareTime` | decreasing | `< 0` and `> -1`  | `> 0` and `< 1`   | `< 0`             |
| _all_         |            | \|value\| ≤ `1e6` | \|value\| ≤ `1e6` | \|value\| ≤ `1e6` |

Every strict inequality is load-bearing, and the direction rule **subsumes** the
op-only rules the first draft of this plan proposed: `0` and `1` are excluded as
endpoints, so no-ops (§1) are gone; `mult ≤ 0` is excluded, so the absorbing case
(§2) and the parity flip (§3) are gone; `add > -1` survives as the one bound
direction alone does not give (§4). One table instead of two sets of rules.

The `1e6` ceiling is a typo catch (`1e200`), not a proof — `1e6 ** 60` is still
`Infinity` and several refs multiply. Layer 3 is the proof.

**Where the direction table lives.** `ATTACK_STAT_DIRECTION: Record<AttackStat, 'increase' | 'decrease'>`
in `attack-stat.ts`, beside `ATTACK_STATS` and `OFFSET_STATS` — the per-stat
knowledge is this effect's. The arithmetic is generic and goes in
[value-guard.ts](../../shared/src/modifiers/value-guard.ts) as
`guardScaledStatValue(direction, op, label)`, mirroring
`guardModifierValue(intent, label)` exactly, so `batteryStat` (whose stats have
directions of their own — `factor` up, `drainRate` down) can adopt it with a
table and one line.

Adding a stat therefore means adding a floor _and_ a direction — both next to the
enum member, so neither can be forgotten silently.

**Shape.** Extend the `superRefine` that `attack-stat.ts` already carries for the
op/stat pairing, attaching the issue to `path: ['value']` so the editor surfaces
it on the right field (`writeFrom` renders `issues[0].message`,
[effects-editor.ts:409-412](../../client/src/dev/editor/effects-editor.ts#L409-L412)).

**Do not model this as a discriminated union on `op`.** It is the obvious zod
move and it breaks the editor: `describeEffectSchema` renders a union as a
_variant picker_ ([effect-schema.ts:134-140](../../client/src/dev/editor/effect-schema.ts#L134-L140)),
so one clean `attack → stat → op` form would become three variants and lose the
narrowing plan 36 built. Object-level refinement keeps the `object` shape, which
is the same reason the existing pairing check is written that way.

Message style copies `guardModifierValue` — state the rule, name the direction,
echo the value, and (where an op is the wrong tool rather than the value being
wrong) point at the op that is:
`attackStat 'prepareTime' is improved by decreasing it, so a 'mult' value must be between 0 and 1; got 2`.

### Layer 2 — `validateModeDefinition`: the value against its context

Three checks that need the host upgrade or the named attack, so they cannot live
in the schema. They go in the `checkAttackStat` loop plan 36 added
([modes/index.ts:203-231](../../shared/src/modes/index.ts#L203-L231)), which
already walks mode-level and per-upgrade refs and knows `where`.

**(a) A negative `add` must survive its own purchase limit.** Require
`1 + value * purchaseLimit > 0`. Consequences worth stating plainly:

- `add: -0.2` with `purchaseLimit: 5` is rejected — the fifth copy resolves to
  exactly `0`.
- A negative `add` on an **unlimited** upgrade (`purchaseLimit: Infinity`) is
  always rejected, correctly: "−20% per level, forever" reaches free and then
  negative.
- `mult` in `(0, 1)` decays asymptotically and is never rejected. That
  asymmetry is the point — `mult` is the right op for an unbounded reduction, and
  this check is what pushes an author toward it.

Under layer 1's direction rule a reduction on `prepareCost`/`prepareTime` _must_
be a negative `add`, so this check governs every `add`-authored reduction line:
`add` stays usable for a **bounded** track (`add: -0.1` capped at 5 levels →
×0.5 at max), and anything unbounded is authored as `mult`. For `power`, where
the direction rule forces `add > 0`, the check never fires — a positive `add`
cannot cross zero.

Caveat, stated in the code comment: adds from _different_ upgrades stack, so a
node rejected here could in principle be rescued by a sibling. No mode authors
that today, and a stat that is dead on its own is worth refusing to boot over.

**(b) A named-attack `offset` must not be dead at level one.** For
`stat: 'prepareTime'`, `op: 'offset'`, a named `attack`, and
`value <= -(def.prepareTimeSec ?? 0)`: the first copy already floors the delay to
`0` and every later copy is dead weight.

**(c) A stat must have something to move.** For a named attack:

- `prepareTime` with `add`/`mult` against `prepareTimeSec: 0` — scaling zero.
- `prepareCost` with `add`/`mult` against an absent or empty `prepareCost` —
  scaling an empty map.

Besides catching dead authoring, (c) closes §5's `NaN` path for every ref. (As
built, `attack` is required, so there is no all-attacks form left to slip past
it; layer 3 stays as the backstop for products of several refs.)

### Layer 3 — `collectAttackParams`: a total clamp, not just a floor

Keep `ATTACK_PARAM_FLOORS`, add `MAX_ATTACK_PARAM = 1e9`, and make the clamp
**total** — `Math.min` propagates `NaN`, so the resolved value needs an explicit
`Number.isFinite` check that maps a non-finite product to the ceiling. Apply the
same bound, signed, to `prepareTimeOffsetSec`.

`1e9` because every consumer has long saturated by then (a steal at
`MAX_STEAL_FRACTION`, a debuff at `MIN_DEBUFF_FACTOR`, a cost at unaffordable),
and `1e9 ×` any authored number stays finite.

With layer 1 in place this is a **backstop, not the main defence** — say so in
the doc comment rather than overselling it. The direction rule already bounds
`prepareCost` and `prepareTime` multipliers to `(0, 1]`, so the only stat that
can still overflow is `power`, and the only `NaN` it reaches is §5's
`scaleCostFactor` path. The clamp is worth the four lines anyway: it costs
nothing per call, it covers the stacked products layer 2 cannot inspect, and it
is what keeps "no authored tree produces a non-finite attack param" true when a
later plan adds a stat or an op — `duration` (plan 37) being the next one.

### Layer 0, really — the editor must stop seeding invalid params

Layer 1 breaks the add-effect path, and the break is pre-existing:
`defaultParamsForVariant` seeds every numeric field with `0`
([effect-schema.ts:164-174](../../client/src/dev/editor/effect-schema.ts#L164-L174)),
`defaultParamsForEffect` falls back to that variant when nothing validates, and
the add button writes the result into the tree **without a `safeParse`**
([effects-editor.ts:581-584](../../client/src/dev/editor/effects-editor.ts#L581-L584)).
Today that already writes an invalid `balancedGenerators` (`multiplier: 0` against
`z.number().gt(1)`); with layer 1 it would also write an invalid `attackStat`
(`op: 'add', value: 0`) — and the block shows no error until some field changes,
so the author saves a tree that refuses to boot.

Fix it generically, not with a per-effect defaults table (which would drift from
the schemas the whole form is derived from): give `defaultParamsForEffect` a
small **candidate ladder** — `0`, `2`, `0.5` — trying each as the value of _every_
numeric field in the variant and keeping the first params object the real schema
accepts. Three parses, no combinatorics, and it covers every guarded effect in
the seed today (`attackStat` → `2`; `balancedGenerators`/`dominantGenerator` →
`2`; `batteryBand`, whose `threshold` is `gt(0).lt(1)` and `bonus` `gt(0)` → `0.5`).

Then have `buildEffectBlock` validate its initial params on build (it currently
only calls `renderPreview`), so a ref that cannot boot shows its reason the
moment the author opens it — including legacy ones.

---

## What this deliberately does not do

- **No balance bounds.** Nothing here caps how strong a stat may be; `mult: 100`
  on `power` loads. Saturation (`MAX_STEAL_FRACTION`, `MIN_DEBUFF_FACTOR`) is the
  mechanic's answer to that, and the dev panel is where the tuning conversation
  happens. The direction rule constrains the _sign_, never the magnitude.
- **No trade-off nodes.** "+50% power, +2s prep" becomes unauthorable — see the
  rejected alternative below.
- **`batteryStat` is untouched**, despite the identical hole. The helper is
  written so it is a one-line adoption; doing it here would silently change what
  the battery tree accepts.
- **No runtime/wire change.** Layers 1 and 2 run at load, layer 3 is arithmetic
  inside an existing function. No message, no state, no server logic.

---

## Rejected alternative: a direction-agnostic guard (keep trade-off nodes open)

The first draft of this plan guarded the **op** only — `mult > 0, ≠ 1`;
`add > -1, ≠ 0`; `offset ≠ 0` — rejecting no-ops and incoherence while leaving
both directions legal, on the grounds that "+50% power, +2s prep" is a standard
incremental-game idiom and attacks are where it would live.

Rejected, for three reasons:

1. **The codebase already took the other position.** `baseModifier` — the
   upgrade-hosted production effect, the closest analogue there is — is guarded
   `intent: 'bonus'`, so "this upgrade makes your own income worse" is already
   unauthorable. An `attackStat` that permits it would be the one exception, and
   an exception nobody has asked for yet.
2. **It was incoherent as drawn.** Banning `offset: +2` while permitting
   `mult: 2` on `prepareTime` guards the spelling of a self-nerf rather than the
   self-nerf. Consistency leaves only two options: permit both, or ban both.
3. **A sign error is the failure this whole plan is for.** With both directions
   legal, `mult: 0.5` typed into a `power` field is a valid upgrade that makes
   your attacks worse, and nothing — not boot, not the editor, not the card —
   says so. The direction rule turns the most likely authoring mistake into a
   boot error naming the field.

If trade-off attacks later become a design goal, the shape is an **explicit
opt-in**, not a hole: a `tradeoff: true` param (or an `intent` beside the stat,
exactly as `guardModifierValue` takes one) that inverts the expected direction
for that ref — so the node declares what it is, and a ref that forgot to declare
it still fails. That keeps the default safe and makes the rare case legible in
the tree file and on the card.

---

## Files touched

| File                                                                                     | Change                                                                                                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [shared/src/modifiers/value-guard.ts](../../shared/src/modifiers/value-guard.ts)         | `guardScaledStatValue(label, directions)` — the arithmetic + the sanity ceiling                                            |
| [shared/src/modifiers/index.ts](../../shared/src/modifiers/index.ts)                     | export it                                                                                                                  |
| [shared/src/effects/seed/attack-stat.ts](../../shared/src/effects/seed/attack-stat.ts)   | `ATTACK_STAT_DIRECTION`; apply the guard in the existing `superRefine`; rewrite the "deliberately unconstrained" doc block |
| [shared/src/attacks.ts](../../shared/src/attacks.ts)                                     | `MAX_ATTACK_PARAM`, total finite clamp, signed bound on `prepareTimeOffsetSec`                                             |
| [shared/src/modes/index.ts](../../shared/src/modes/index.ts)                             | the three context checks in `checkAttackStat`                                                                              |
| [client/src/dev/editor/effect-schema.ts](../../client/src/dev/editor/effect-schema.ts)   | candidate ladder + include-optionals pass in `defaultParamsForEffect`                                                      |
| [client/src/dev/editor/effects-editor.ts](../../client/src/dev/editor/effects-editor.ts) | `repairGuardedValue`; validate on block build; seed a switched variant through the same probe                              |

Server: none. Wire: none. Tree data: none (nothing authors `attackStat` yet, so
no migration — which is exactly why this lands **now** rather than after the
first authored node).

---

## Tests

- [shared/tests/effects.test.ts](../../shared/tests/effects.test.ts) — the
  stat × op accept/reject table, both sides of every boundary. The direction
  cases are the ones that carry the design: `power` rejects `mult: 0.5` and
  `add: -0.1` but takes `mult: 1.5`; `prepareTime` rejects `mult: 2` and
  `offset: +2` but takes `mult: 0.5` and `offset: -1`; endpoints `0`, `1`, `-1`
  reject on every stat; `1e6` passes and `1e7` does not. Table-driven over
  `ATTACK_STATS` × `ATTACK_STAT_OPS` so a stat added without a direction fails
  loudly.
- [shared/tests/attacks.test.ts](../../shared/tests/attacks.test.ts) — resolved
  params land in `[floor, MAX_ATTACK_PARAM]` and are finite for a `power` ref
  that overflows (`mult: 1e6` at many owned copies). Layer 3 is tested through
  `collectAttackParams` directly rather than through an authored tree, since
  layer 1 is what stops such a tree existing — the point is that the clamp holds
  regardless.
- [shared/tests/cost-inflation.test.ts](../../shared/tests/cost-inflation.test.ts)
  — the §5 `NaN` regression, which lives on the cost path: an authored
  `costFactor: 1` scaled by a saturating `power` yields a finite factor, never
  `NaN` prices.
- [shared/tests/flavor.test.ts](../../shared/tests/flavor.test.ts) — where the
  other `validateModeDefinition` cases live: each context check throws with the
  attack/upgrade named, and a `mult`-based
  reduction on an unlimited upgrade is accepted where the `add` equivalent is
  rejected.
- [client/tests/editor-effect-fields.test.ts](../../client/tests/editor-effect-fields.test.ts)
  — every registered effect's default params parse against its own schema (a
  drift guard that would have caught `balancedGenerators` today).
- No e2e, no DOM tier: all of it is pure functions over data.
