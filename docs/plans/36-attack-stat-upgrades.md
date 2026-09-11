# 36 — Attack stat upgrades: making an attack's numbers grow

## Status: Implemented

Sections below are the plan as built; where the implementation departed from the
draft, the change and its reason are marked inline. Nothing is authored on the
idler tree — this is the mechanic, its reporting, and its tests.

First of the three attack-extension plans (36 → 37 → 38): it needs no new wire
field, no new action, and no server logic, and the stat it introduces is what
makes both [37 — duration active attacks](37-duration-active-attacks.md) and
[38 — attack limit](38-attack-limit.md) balanceable.

**Departures from the draft:**

- **A third op, `offset`, in the stat's own unit.** `add`/`mult` shape a
  _multiplier_ on each attack's authored value (there is no global default to add
  to, unlike `batteryStat`), so `add: 5` on `prepareTime` is a ×6 — not five
  seconds, which is how an author reads it. `offset: -1` is literally one second
  sooner, per owned level. It is legal only on `prepareTime`
  (`attackStatOpsFor`): `prepareCost` has a unit _per currency_ and `power` has
  none at all, so a flat shift is undefined for both — the schema rejects those
  pairings and the form never offers them. `AttackParams` carries
  `prepareTimeOffsetSec` beside the multiplier and
  `getAttackPrepareTimeSec(def, params)` composes them, scaling before shifting.
- **The form previews what a ref resolves to.** `describeEffectRef`
  ([effect-preview.ts](../../client/src/dev/editor/effect-preview.ts)) renders a
  line per `attackStat` ref — `a0 prepare time: 10s → 9s (L1) · 8s (L2)` — from
  the _shared_ resolvers, never a restated formula. It is what makes the relative
  ops legible at authoring time instead of at balance time.
- **`duration` is not in `ATTACK_STATS`.** §5 already said to reject it until
  plan 37 lands; shipping it as an enum member would put a dead stat in the
  `/dev.html` form. `AttackParams` therefore carries three fields, and the seed's
  doc names what to add when durations arrive.
- **`scaleCostFactor` joins `scaleDebuffValue`** in
  [value-guard.ts](../../shared/src/modifiers/value-guard.ts), so the
  neutral-point arithmetic for the cost path lives beside the one for the
  production path instead of being inlined in `collectEnemyCostFactors`.
- **The card reports the delay in seconds, not as a factor.** An `offset` shifts
  seconds, which no multiplier can express, and the wait itself is the number a
  player acts on — so the line reads `Prep 4.5s` whenever the resolved delay
  differs from the authored one.
- **The derived card line omits `prepareCost`.** The cost row already quotes the
  discounted price, so a `Cost ×0.5` beside it would state the same fact twice;
  the line carries `Power ×N` and `Prep ×N`. Passive cards get the line too —
  their debuff is scaled by `power` just as a strike is — but **only its `power`
  half**: a passive attack is never activated, and an `attack`-less stat still
  collects a `prepareTime` for it, so printing one would claim a speed-up the card
  can never deliver.
- **The panel test is node tier, not a DOM test.** The panel renders by assigning
  one `innerHTML` string, and
  [testing.instructions.md](../../.github/instructions/testing.instructions.md)
  names "a DOM test for pure string-rendering" an anti-pattern. Lives in
  [client/tests/attack-panel-stats.test.ts](../../client/tests/attack-panel-stats.test.ts),
  which re-registers `idler` with synthetic stat upgrades (the tree authors none).
- **The editor gained a blank option for optional pickers.** §6's open item: the
  form forced a selection, so an optional id field would have silently persisted
  the first attack on the next edit of any sibling field. An optional string field
  with options now leads with `(unset)`.
- **The editor's `stat` picker is narrowed by the named attack.** §5's kind check
  is a boot-time error, which the author only meets as a failed startup after
  saving. `attackStatsFor(kind)` in [attacks.ts](../../shared/src/attacks.ts) is
  now the one list both the validator and the form read, so naming a passive
  attack removes `prepareCost`/`prepareTime` from the picker outright — and
  `OPTION_SOURCE_FIELDS` + `repairOptionValues` re-resolve the block on that edit,
  snapping a now-illegal stat to a legal one instead of persisting it.

---

## Goal

An attack's magnitude is fixed by its authored effect params today: `a0` steals
exactly 10% of the victim's wood forever, and the only progression available is
_unlocking a different attack_. Add **upgrades that scale an attack's numbers**,
so the attack tree has depth as well as breadth: steal more, strike sooner,
prepare cheaper, debuff harder.

Ship the **mechanic + editor form + tests + panel reporting**; author nothing on
[idler.json](../../shared/trees/idler.json), matching what every prior attack
commit did.

---

## What already exists (verified)

- **An exact precedent for "upgrades move a subsystem's parameters."** The
  highlight battery does this: `batteryStat`
  ([seed/battery-stat.ts](../../shared/src/effects/seed/battery-stat.ts)) is an
  upgrade-hosted effect emitting a `BatteryStatOutput { stat, op, value }`
  ([effects/types.ts:207](../../shared/src/effects/types.ts#L207)), and
  [`collectBatteryParams`](../../shared/src/highlight-battery.ts#L102) folds every
  such output into the live parameters — owning the owned-count compounding
  (`add × owned`, `mult ** owned`), the cross-upgrade stacking, and the clamping.
  The seed's own doc states the design rule this plan reuses verbatim: one effect
  with a `stat` enum rather than four near-identical effects, and `value` left
  unguarded because the meaningful range differs per stat while the _collector_
  clamps the result.
- **Every attack number already funnels through one function each.**
  `prepareCost` → [`getAttackPrepareCost`](../../shared/src/attacks.ts#L37) (read
  by [`attackBlockReason`](../../shared/src/attacks.ts#L50),
  [`applyAttackActivation`](../../shared/src/attacks.ts#L84) and the panel's
  [`renderCost`](../../client/src/ui/panels/attack-panel.ts#L32)); `prepareTimeSec`
  → `applyAttackActivation`; steal magnitudes →
  [`resolveAttackStrike`](../../shared/src/attacks.ts#L147); debuff values →
  [`collectEnemyDebuffs`](../../shared/src/modes/index.ts#L1094); cost inflation →
  [`collectEnemyCostFactors`](../../shared/src/modes/index.ts#L1125). There is no
  sixth place an attack number is read.
- **The attacker's state is already threaded into attack effects.** Both
  `resolveAttackStrike` ([attacks.ts:155](../../shared/src/attacks.ts#L155)) and
  `collectEnemyDebuffs` ([modes/index.ts:1102](../../shared/src/modes/index.ts#L1102))
  call `applyEffect(ref, attacker, mode)`, and the latter's doc already says the
  attacker's state is passed "so future state-relative debuffs can read it."
- **Effect placement is enforced generically.** `EffectDef.hosts`
  ([effects/types.ts:372](../../shared/src/effects/types.ts#L372)) plus the
  boot-time `checkHost` loop
  ([modes/index.ts:311-329](../../shared/src/modes/index.ts#L311-L329)) reject an
  effect authored on the wrong host, and the `/dev.html` picker only offers
  effects legal for the section being edited.
- **Id-referencing params get a picker, not free text.**
  [`effectFieldOptions`](../../client/src/dev/editor/effects-editor.ts#L105) maps
  `(effectType, fieldKey)` → option list; `unlockAttack`'s `attack` already
  resolves to `tree.attacks.map((a) => a.id)`, and
  [editor-effect-fields.test.ts](../../client/tests/editor-effect-fields.test.ts)
  asserts every id-referencing param resolves to one.
- **Attack cards render static flavor text.** `renderActiveAttack`
  ([attack-panel.ts:64](../../client/src/ui/panels/attack-panel.ts#L64)) shows
  `getAttackDescription(flavor, id)` — an authored string, unaware of any number.
- **Attacks are not in the simulator.** `shared/src/simulation/` has no attack
  handling at all (grep: zero hits), and the bot never activates one
  (`server/src/bot.ts`: zero hits). Neither is a blocker here, and neither is
  fixed here.

---

## Approach

### 1. One effect, a small stat enum, kind-aware arithmetic

New seed effect `attackStat`, registered in
[effects/index.ts](../../shared/src/effects/index.ts), hosted on the
**production-pipeline hosts** (`mode` + `upgrade` — the default), _not_ on the
attacks themselves: it is a thing an upgrade grants, not a thing an attack
carries.

```ts
/** The attack parameters an `attackStat` effect can move. */
// As built: `duration` omitted until plan 37 gives it a consumer.
export const ATTACK_STATS = ['power', 'prepareCost', 'prepareTime'] as const

const schema = z.strictObject({
  /** Which attack to buff, or absent for every attack in the mode. */
  attack: z.string().optional(),
  stat: z.enum(ATTACK_STATS),
  op: z.enum(['add', 'mult']),
  value: z.number(),
})
```

`attack` optional-means-all mirrors [`EnemyCostOutput.id`](../../shared/src/effects/types.ts#L160)
("a specific upgrade/generator id, or absent for every entity of the scope"), so
"+20% to all raids" is one node rather than one node per attack.

**`power` is deliberately one stat, not four.** An attack's magnitude lives in a
different field depending on what it does — `fraction`, `amount`, `count`,
`modifier.value`, `costFactor` — but an author thinks in one currency ("this
raid hits harder"). The collector knows the _output kind_ at the moment it
applies the scale, so the per-kind arithmetic belongs there (§3), and the enum
stays readable. An attack whose effects mix kinds (a steal _and_ a debuff) has
both scaled by the same `power`, which is the intent.

### 2. `collectAttackParams` — the battery collector, transplanted

```ts
export interface AttackParams {
  readonly power: number // multiplier on magnitude, 1 = authored value
  readonly prepareCost: number // multiplier on every cost currency
  readonly prepareTime: number // multiplier on prepareTimeSec
  // `duration` (plan 37) is deliberately absent — see the departures above.
}

export function collectAttackParams(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  attackId: string,
): AttackParams
```

Lives in [attacks.ts](../../shared/src/attacks.ts) next to the consumers. Body is
`collectBatteryParams` with the stat table swapped: seed `adds` to 0 and `mults`
to 1 per stat, walk `mode.effects` at `owned = 1` then every owned upgrade at its
owned count, skip refs whose `ref.type !== 'attackStat'` without running them,
skip refs whose `attack` names a different id, accumulate `add × owned` /
`mult ** owned`, resolve as `(1 + add) * mult`, then clamp.

Clamps (the collector owns them, so a mis-authored value is inert rather than
inverting the mechanic):

| stat          | floor | why                                                   |
| ------------- | ----- | ----------------------------------------------------- |
| `power`       | 0     | a negative magnitude would make a steal a _gift_      |
| `prepareCost` | 0     | free is the floor; negative would credit the attacker |
| `prepareTime` | 0     | `0` already means "strike on the next tick"           |

Cached the way the flavor lookups are (a `WeakMap` keyed by mode) only if
profiling asks for it — `collectBatteryParams` runs uncached per call today, and
the attack paths run far less often than it does.

### 3. Where the params land (four sites, and one of them is the real design work)

**`getAttackPrepareCost(def)` → `getAttackPrepareCost(def, params)`.** Multiply
each currency by `params.prepareCost`. The signature grows a second argument at
four call sites (`attackBlockReason`, `applyAttackActivation`, the panel's
`renderCost`, and the tests). Keeping it as a pure `(def, params)` function — not
`(def, state, mode)` — keeps `attacks.ts` free of a second collector call per
render.

**`applyAttackActivation`** stamps `readyAtSec` from
`getAttackPrepareTimeSec(def, params)` — the authored delay scaled by
`params.prepareTime`, then shifted by `params.prepareTimeOffsetSec` (the absolute
`offset` op), floored at `0`. Note the consequence: the delay
is frozen at activation, so buying a prepare-time upgrade while a strike is in
flight does not pull that strike forward. That is the right behavior (the client
predicted a `readyAtSec` and the server must agree) and it should be stated on
the stat's doc comment.

**`resolveAttackStrike`** scales each steal output before it caps against the
victim's holdings:

- `resourceSteal` — `fraction × power`, clamped to `≤ 1`; `amount × power`.
- `generatorSteal` — `fraction × power` clamped to `≤ 1`; `count × power` then
  `Math.floor` (copies are whole numbers, and the existing floor-then-cap order
  at [attacks.ts:169](../../shared/src/attacks.ts#L169) must not change).

**`collectEnemyDebuffs` / `collectEnemyCostFactors`** are the interesting ones,
because a debuff's magnitude is not its `value`.

### 4. Scaling a debuff means scaling the deficit, not the value

A `multiplicative` debuff of `0.9` is a 10% penalty. "Twice as strong" is `0.8`,
not `1.8`. Scaling the raw value would invert the mechanic the moment `power`
exceeds `1`, and would sail straight past
[`guardModifierValue`](../../shared/src/modifiers/value-guard.ts), which only
checks the _authored_ value at load and never sees the runtime product.

So the collector scales the **distance from the stage's neutral point**, which is
exactly the convention the cost curve already uses (`scalingFactor` multiplies
the _growth portion_, `costScaling - 1`, not the whole scaling) and the one
`value-guard.ts` already names ("`additive` is neutral at `0` and
`multiplicative` at `1`"):

| output                          | authored | scaled by `power = p`                  |
| ------------------------------- | -------- | -------------------------------------- |
| `enemyModifier`, additive       | `v < 0`  | `v × p`                                |
| `enemyModifier`, multiplicative | `v < 1`  | `1 - (1 - v) × p`, clamped to `(0, 1]` |
| `enemyCost`, `costFactor`       | `f > 1`  | `1 + (f - 1) × p`, clamped to `≥ 1`    |
| `enemyCost`, `scalingFactor`    | `f > 1`  | `1 + (f - 1) × p`, clamped to `≥ 1`    |

The multiplicative clamp is not cosmetic: at `power = 10` an authored `0.9`
resolves to `0.0`, and a factor of `0` **zeros** the victim's production instead
of scaling it — the precise case `isMeaningfulModifierValue` refuses to let
anyone author. Clamp to a floor (`MIN_DEBUFF_FACTOR`, e.g. `0.05`) and the
mechanic saturates instead of deleting the opponent.

A single helper — `scaleDebuffValue(stage, value, power)` — next to
`guardModifierValue` keeps the neutral-point knowledge in one file, and gives the
tests one function to characterize.

### 5. Boot validation

In `validateModeDefinition`, beside the existing `unlockAttack` id check
([modes/index.ts:185-196](../../shared/src/modes/index.ts#L185-L196)):

- `attack`, when present, must name a real attack → otherwise the node silently
  buffs nothing.
- `duration` may only target an `active` attack (it is meaningless on a passive
  one, and meaningless entirely until plan 37 lands — until then, reject the stat
  outright rather than ship a dead enum member).
- `prepareCost` / `prepareTime` may only target an `active` attack — a passive
  attack is forbidden from declaring either field
  ([modes/index.ts:391-396](../../shared/src/modes/index.ts#L391-L396)), so a
  stat aimed at one is authored dead weight.
- An `attackStat` with no `attack` and a stat that only some attacks can use is
  legal — it applies to those that can.

### 6. Editor

Add one branch to
[`effectFieldOptions`](../../client/src/dev/editor/effects-editor.ts#L105):

```ts
if ((effectType === 'unlockAttack' || effectType === 'attackStat') && fieldKey === 'attack') {
  return tree.attacks.map((a) => a.id)
}
```

`stat` and `op` are zod enums, so the schema-driven form renders them as selects
with no extra work — except that `stat`'s legal members **depend on the attack
named beside it**. `effectFieldOptions` therefore takes the ref's current params
and returns `attackStatsFor(kind)` for `stat`, the same list the boot-time check
uses; a passive attack is left with `power` alone. Because a select's options are
built once per render, `OPTION_SOURCE_FIELDS` declares `attack` as the param the
rest of the block depends on: editing it re-resolves every option set and
`repairOptionValues` snaps any value the narrowed set no longer offers to its
first legal option, so the form can't hand the tree file a pairing that refuses to
boot.
[editor-effect-options.dom.test.ts](../../client/tests/editor-effect-options.dom.test.ts)
covers that live-select behavior; the option sets themselves are node tier. The optional `attack` needed the form to offer an empty "all
attacks" choice, and it did not have one: `buildEffectField` rendered every
option-bearing string field as a select with no blank entry, so the browser
pre-selected the first attack and the next edit to a sibling field would persist
it. As built, an **optional** option-bearing field leads with an `(unset)` entry
(one branch in `buildEffectField`, so every future optional picker gets it too).
`attackStat` is also listed in the picker's `Offense` group, which the
`EFFECT_GROUPS` drift guard requires.

### 7. The panel has to stop lying

`getAttackDescription` is authored flavor text: "Steal 10% of the enemy's wood."
Once an upgrade makes it 18%, the card is wrong — and wrong in the direction that
reads as the upgrade having done nothing.

Minimum viable fix, and it stays inside the panel: when
`collectAttackParams(...).power !== 1`, append a computed line to the card —
`Power ×1.8` — beside the cost, and show `prepareTime` the same way. As built the
line omits `prepareCost`: `renderCost` now takes the params, so the cost row
already quotes the discounted price and a factor beside it would restate it.

`renderStats` takes the attack's `kind`, and a **passive** card shows `power`
only. Its debuff is scaled by `power` just as a strike is, so the line belongs
there — but a passive attack is never activated (`validateModeDefinition` forbids
it from declaring a prepare cost or delay), while an `attackStat` naming no attack
collects those params for every attack regardless. Gating on the kind is what
keeps the card from advertising a delay the attack doesn't have.

The authored description keeps describing the _shape_ of the attack; the derived
line carries the current numbers.

Rejected for v1: resolving the flavor string's own numbers (template
placeholders in the description). It makes flavor text depend on effect
introspection in a way nothing else in the codebase does, and every mode's
authoring becomes stat-aware.

Not `dynamic: true` on the effect: that flag routes an effect into the data
panel's live-bonuses section (`collectDynamicBonuses`), which is about
_production_ modifiers. An `attackStat` emits no modifier and pays nothing per
second — its worth belongs on the attack card, which is where §7 puts it.

### 8. What does _not_ change

No wire field, no new action type, no reconciliation work. Both sides derive the
params from owned upgrades, which are already synced; the client's optimistic
`activate_attack` path
([game.ts:564](../../client/src/game.ts#L564), replayed at
[game.ts:761-766](../../client/src/game.ts#L761-L766)) computes the same
`prepareCost`/`readyAtSec` as the server because it calls the same shared
functions. Strike magnitude is resolved server-side only, so there is nothing to
predict there.

---

## Rejected alternative: let each attack effect read the attacker's upgrades

`applyEffect(ref, attacker, mode)` already hands `stealResource` the attacker's
state, so each seed effect _could_ scale itself (mark it `dynamic: true`, read
`state.upgrades`, multiply). Rejected on three counts: the owned-count
compounding and clamping would be duplicated in every offensive effect (the exact
duplication `collectBatteryParams` exists to avoid); each effect would have to
know which upgrade ids buff it, hard-coding tree topology into a seed effect; and
an author could no longer add "+20% to all raids" without editing TypeScript.

## Rejected alternative: attacks get purchasable levels of their own

Give `AttackDefinition` a cost curve and store `state.attackLevels`. That is a
new purchase system — a new action type, new state, new validation, new cost
paths, new prediction — to express what an upgrade node already expresses. It
also splits attack progression away from the tree the player already reads, and
away from the `/dev.html` editor. If attacks ever need _independent_ pacing
(spend during the round to power up mid-fight), revisit it then.

---

## Files touched

| File                                                                                     | Change                                                                             |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shared/src/effects/seed/attack-stat.ts`                                                 | **new** — the stat/op enums, `attackStatOpsFor`, schema, `apply`                   |
| [shared/src/effects/index.ts](../../shared/src/effects/index.ts)                         | register `attackStat`                                                              |
| [shared/src/effects/types.ts](../../shared/src/effects/types.ts)                         | `AttackStatOutput` + add to the `EffectOutput` union and its doc                   |
| [shared/src/attacks.ts](../../shared/src/attacks.ts)                                     | `AttackParams`, `collectAttackParams`, `getAttackPrepareTimeSec`, `attackStatsFor` |
| [shared/src/modifiers/value-guard.ts](../../shared/src/modifiers/value-guard.ts)         | `scaleDebuffValue`, `scaleCostFactor`, `MIN_DEBUFF_FACTOR`                         |
| [shared/src/modes/index.ts](../../shared/src/modes/index.ts)                             | scale in `collectEnemyDebuffs` / `collectEnemyCostFactors`; validation             |
| [shared/src/modifiers/index.ts](../../shared/src/modifiers/index.ts)                     | export the two scaling helpers + the floor                                         |
| [client/src/ui/panels/attack-panel.ts](../../client/src/ui/panels/attack-panel.ts)       | params-aware cost, derived power/time line                                         |
| [client/src/dev/editor/effects-editor.ts](../../client/src/dev/editor/effects-editor.ts) | `attack`/`stat`/`op` pickers, `(unset)`, operator labels, preview row              |
| `client/src/dev/editor/effect-preview.ts`                                                | **new** — `describeEffectRef`, the resolved preview line                           |
| [client/src/dev/dev.css](../../client/src/dev/dev.css)                                   | one class for the preview row                                                      |
| [client/src/style.css](../../client/src/style.css)                                       | one class for the derived stat line                                                |

Server: none. Wire: none.

---

## Data / type changes

```ts
export interface AttackStatOutput {
  readonly kind: 'attackStat'
  /** Which attack this moves, or absent for every attack. */
  readonly attack?: string
  readonly stat: AttackStat
  readonly op: 'add' | 'mult'
  readonly value: number
}
```

`AttackDefinition`, `PlayerState`, and every wire message are unchanged.

---

## Tests

**shared/tests/attacks.test.ts** (extend)

- `collectAttackParams`: unowned upgrade → all `1`; `add` scales linearly with
  owned count; `mult` compounds (`value ** owned`); two upgrades stack; a
  mode-level `attackStat` applies at owned 1; an `attack`-less ref buffs every
  attack; a mismatched `attack` buffs none; each clamp floor holds.
- `getAttackPrepareCost` with `prepareCost: 0.5` halves every currency, and
  `attackBlockReason` flips `unaffordable → null` at the discounted price.
- `applyAttackActivation` stamps `readyAtSec` from the scaled prepare time, and a
  later stat purchase does not move an in-flight `readyAtSec`.
- `resolveAttackStrike`: `power` scales a fraction steal, a flat steal, and a
  generator count; a fraction scaled past 1 still takes at most the victim's
  whole stockpile; a scaled generator count still floors.

**shared/tests/effects.test.ts** (extend) — the schema rejects an unknown `stat`,
an unknown `op`, and a non-numeric `value`; host placement rejects `attackStat`
on an attack.

**shared/tests/pipeline.test.ts or a new debuff-scaling test** —
`scaleDebuffValue` characterization: additive `-2` at `power 2` → `-4`;
multiplicative `0.9` at `power 2` → `0.8`; at `power 3` → `0.7`; saturates at
`MIN_DEBUFF_FACTOR` rather than reaching `0`; `power < 1` weakens toward neutral
and never crosses it.

**shared/tests/flavor.test.ts** (extend) — `validateModeDefinition` throws for an
`attackStat` naming an unknown attack, and for `prepareTime`/`prepareCost`/
`duration` aimed at a passive attack.

**shared/tests/cost-inflation.test.ts** (extend) — a `power`-buffed
`enemyCostModifier` raises the victim's quoted price, and `1 + (f-1) × p` is what
lands (not `f × p`).

**client/tests/editor-effect-fields.test.ts** (extend) — `attackStat`'s `attack`
resolves to a picker over the tree's attacks.

**client/tests/attack-panel-stats.test.ts** — asserting the card shows the
discounted cost, enables the button at a price only the discount makes
affordable, and carries the derived `Power ×N` / `Prep ×N` line only when a stat
is owned. Tier per
[testing.instructions.md](../../.github/instructions/testing.instructions.md):
the panel renders one `innerHTML` string, so **node** is the lowest tier that can
fail truthfully (a happy-dom mount would be "a DOM test for pure string
rendering", which that file names as an anti-pattern). The suite re-registers
`idler` with synthetic stat upgrades, since the tree authors none.

---

## Open questions — resolved

1. **`power` as one stat, or split per output kind?** **Shipped as one stat.** One
   stat is better authoring and worse precision: an attack that both steals and
   debuffs cannot have only its steal buffed. Splitting later is a compatible
   change (add enum members; `power` keeps meaning "all of them"), and a `TODO` on
   the seed's doc comment records that as the thing to revisit if an attack ever
   needs half its magnitude buffed.
2. **Should `power` also scale a steal's `fraction` past 1?** **Clamped at 1**
   (`MAX_STEAL_FRACTION` in [attacks.ts](../../shared/src/attacks.ts), with the
   reasoning on the const). Letting it overshoot and relying on the
   victim-holdings cap would make an upgrade silently worthless the moment the
   fraction saturates, with no way for the panel to say so.
3. **Does a `prepareCost` discount reach the refund path?** Moot — attacks have no
   refund. If one is ever added it must be priced off the _paid_ cost, which the
   pending entry does not record; the same asymmetry
   [plan 33 §4](33-enemy-cost-inflation.md) resolved for generator sell refunds.
4. **Per-mode stat catalog?** Moot while `idler` is the only mode.
   `ATTACK_STATS` is a global enum exactly like `BATTERY_STATS`, and carries the
   same latent question — not worth solving before a second mode exists.

---

## Deferred

- **Simulator support.** `shared/src/simulation/` still has no attack handling at
  all, so a stat-buffed attack contributes nothing to a strategy run. Owed since
  [plan 29](29-active-attacks.md); this plan does not pay it down.
- **Bot support.** `server/src/bot.ts` never activates an attack, so stat
  upgrades are player-only in a bot match.
- **Authoring on the idler tree.** No nodes here — a separate authoring pass, done
  in `/dev.html`.
