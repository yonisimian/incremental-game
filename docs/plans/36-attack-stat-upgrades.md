# 36 — Attack stat upgrades: making an attack's numbers grow

## Status: Proposed — not implemented

Recommended first of the three attack-extension plans (36 → 37 → 38): it needs no
new wire field, no new action, and no server logic, and the stat it introduces is
what makes both [37 — duration active attacks](37-duration-active-attacks.md) and
[38 — attack limit](38-attack-limit.md) balanceable.

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
export const ATTACK_STATS = ['power', 'prepareCost', 'prepareTime', 'duration'] as const

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
  readonly duration: number // multiplier on durationSec (plan 37)
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

| stat          | floor | why                                                       |
| ------------- | ----- | --------------------------------------------------------- |
| `power`       | 0     | a negative magnitude would make a steal a _gift_          |
| `prepareCost` | 0     | free is the floor; negative would credit the attacker     |
| `prepareTime` | 0     | `0` already means "strike on the next tick"               |
| `duration`    | 0     | a negative window would expire before it starts (plan 37) |

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

**`applyAttackActivation`** multiplies `def.prepareTimeSec` by
`params.prepareTime` when stamping `readyAtSec`. Note the consequence: the delay
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
if (effectType === 'attackStat' && fieldKey === 'attack') {
  return tree.attacks.map((a) => a.id)
}
```

`stat` and `op` are zod enums, so the schema-driven form renders them as selects
with no extra work. The optional `attack` needs the form to offer an empty "all
attacks" choice — check whether the current form generator renders
`z.string().optional()` with a blank option or forces a selection
([effects-editor.ts](../../client/src/dev/editor/effects-editor.ts), and
[editor-effect-schema.test.ts](../../client/tests/editor-effect-schema.test.ts)
for what it already guarantees).

### 7. The panel has to stop lying

`getAttackDescription` is authored flavor text: "Steal 10% of the enemy's wood."
Once an upgrade makes it 18%, the card is wrong — and wrong in the direction that
reads as the upgrade having done nothing.

Minimum viable fix, and it stays inside the panel: when
`collectAttackParams(...).power !== 1`, append a computed line to the card —
`Power ×1.8` — beside the cost, and show `prepareTime`/`prepareCost` the same way
(the cost row already recomputes, since `renderCost` will take the params). The
authored description keeps describing the _shape_ of the attack; the derived line
carries the current numbers.

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

| File                                                                                     | Change                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `shared/src/effects/seed/attack-stat.ts`                                                 | **new** — `ATTACK_STATS`, schema, `apply`                               |
| [shared/src/effects/index.ts](../../shared/src/effects/index.ts)                         | register `attackStat`                                                   |
| [shared/src/effects/types.ts](../../shared/src/effects/types.ts)                         | `AttackStatOutput` + add to the `EffectOutput` union and its doc        |
| [shared/src/attacks.ts](../../shared/src/attacks.ts)                                     | `AttackParams`, `collectAttackParams`, params threaded into cost/strike |
| [shared/src/modifiers/value-guard.ts](../../shared/src/modifiers/value-guard.ts)         | `scaleDebuffValue` + `MIN_DEBUFF_FACTOR`                                |
| [shared/src/modes/index.ts](../../shared/src/modes/index.ts)                             | scale in `collectEnemyDebuffs` / `collectEnemyCostFactors`; validation  |
| [shared/src/index.ts](../../shared/src/index.ts)                                         | export the new surface                                                  |
| [client/src/ui/panels/attack-panel.ts](../../client/src/ui/panels/attack-panel.ts)       | params-aware cost, derived power/time line                              |
| [client/src/dev/editor/effects-editor.ts](../../client/src/dev/editor/effects-editor.ts) | `attack` picker for `attackStat`                                        |
| [client/src/style.css](../../client/src/style.css)                                       | one class for the derived stat line                                     |

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

**client/tests/** — a DOM test (`attack-panel.dom.test.ts`) asserting the card
shows the discounted cost and the derived `Power ×N` line only when a stat is
owned. Tier per
[testing.instructions.md](../../.github/instructions/testing.instructions.md):
the panel renders from `GameState`, so happy-dom is the lowest tier that can fail
truthfully.

---

## Open questions

1. **`power` as one stat, or split per output kind?** One stat is better
   authoring and worse precision: an attack that both steals and debuffs cannot
   have only its steal buffed. Splitting later is a compatible change (add enum
   members; `power` keeps meaning "all of them"), so ship one.
2. **Should `power` also scale a steal's `fraction` past 1?** Clamping at 1
   ("take everything") is proposed. The alternative — let it overshoot and rely on
   the victim-holdings cap — makes an upgrade silently worthless the moment the
   fraction saturates, with no way for the panel to say so.
3. **Does a `prepareCost` discount reach the refund path?** Attacks have no
   refund today. If one is ever added, it must be priced off the _paid_ cost,
   which the pending entry does not currently record — the same asymmetry
   [plan 33 §4](33-enemy-cost-inflation.md) resolved for generator sell refunds.
4. **Per-mode stat catalog?** `BATTERY_STATS` is a global enum and the battery is
   idler-only. `ATTACK_STATS` has the same shape and the same latent question; not
   worth solving before a second mode exists.

---

## Deferred

- **Simulator support.** `shared/src/simulation/` still has no attack handling at
  all, so a stat-buffed attack contributes nothing to a strategy run. Owed since
  [plan 29](29-active-attacks.md); this plan does not pay it down.
- **Bot support.** `server/src/bot.ts` never activates an attack, so stat
  upgrades are player-only in a bot match.
- **Authoring on the idler tree.** No nodes here — a separate authoring pass, done
  in `/dev.html`.
