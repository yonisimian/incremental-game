# 40 — Enemy purchase lock: a timed embargo on the victim's purchases

## Status: Implemented (branch `feat/8-stop-buy-option`)

### As built — departures from the text below

- **Open question 1 resolved as (c), not (b).** `incomingPurchaseLocks` is a
  `PurchaseLock[]` of `{ scope, untilSec }` — one entry per scope, carrying the
  latest expiry among the windows locking it — rather than a scope list plus a
  separate `untilSec`. Option (c)'s stated downside (changing a type every
  consumer reads) does not apply to a brand-new field, and one field is simpler
  to stamp, clone, and read than two. **Presence blocks; `untilSec` is display
  only**, so a client whose clock has drifted still agrees with the server on
  whether a buy goes through (`isPurchaseLocked` / `purchaseLockRemainingSec`
  in `purchase-validation.ts`).
- **Open question 2 resolved: yes.** A `power` attackStat aimed at an attack
  whose effects are all locks is a boot error, mirroring plan 37's `duration`
  rule; a raid that steals and locks keeps `power` legal.
- **Open question 3 resolved: `purchases` stays**, and the overlap rule in §6
  shipped (two locks on one attack whose scopes overlap throw at boot).
- **The bot needed a guard, not just a note.** `advancePlan` increments its
  plan index when it _emits_ a buy, so a lock would have made it skip the
  planned upgrade for good. It now holds the step while `upgrade` is locked;
  `buyGenerators` skips the tick while `generator` is.
- **`attacksInForce` gained a sibling, `windowsInForce`**, returning each open
  window with its expiry. The two existing collectors are untouched; the lock
  collector reads the expiry from the same walk rather than re-deriving which
  windows are open.
- **Client copy.** Tree nodes get a `locked-by-attack` class (danger ring), the
  detail popup says `Enemy attack — 🔒 Locked N.Ns`, generator buy buttons show
  `🔒 Locked N.Ns` with Sell live, and the espionage panel's "Enemy Attacks"
  section gains `🔒 You cannot buy upgrades [or generators] for N.Ns.` (one
  sentence when both scopes lift together, one line each otherwise). No new
  toast: the strike emits the existing `debuff` event.
- **Validator messages derive from `DEBUFF_EFFECT_TYPES`** instead of naming
  the two original effects, so a fourth member needs no message edit.
- **One lock attack authored, as test content.** Contrary to the text below,
  `idler.json` gains 🚫 Embargo (3s prep, 10s window, locks `purchases`),
  unlocked by a free node like the other attacks.
- **Per-entity targets after all, from one shared catalog.** `target` is a
  catalog string, not a three-word enum. `purchaseTargets` (in
  `addressable.ts`) is the single list both `enemyCostModifier` and
  `enemyPurchaseLock` use — `upgrades`, `generators`, `purchases` (both),
  `upgrade:<id>`, `generator:<id>` — and `parsePurchaseTarget` reads it back;
  `enemyCostModifier` gains `purchases` as a result, emitting one output per
  scope. `PurchaseLock` carries an optional `id`, `isPurchaseLocked` /
  `purchaseLockRemainingSec` take the entity id, and the overlap rule treats a
  single entity inside a locked scope as an overlap.

Full suite green: shared 851, server 164, client 486. `typecheck`, `lint`,
`lint:css`, `lint:exports`, `format:check` all pass.

---

Fourth offensive lever, and the first that is a **boolean** rather than a
number: while it is in force the opponent cannot buy upgrades, generators, or
both. It rides the duration-window machinery from
[37 — duration active attacks](37-duration-active-attacks.md) unchanged and the
state-carried transport from
[33 — enemy cost inflation](33-enemy-cost-inflation.md) by analogy. Nothing here
adds a subsystem; the work is one seed effect, one output kind, one collector,
one `PlayerState` field, two block reasons, and the UI that explains them.

Ship the **mechanic + validation + editor + UI + tests**; author nothing on
[idler.json](../../shared/trees/idler.json).

---

## Goal

A production debuff slows what the victim earns. Cost inflation raises what they
must earn. A purchase lock does neither — it takes away their **timing**: for
the window's length they cannot convert the stockpile they have into the next
tier, the next generator, the trophy. Fired while the opponent is one purchase
from a milestone, it is the strongest thing in the attack kit; fired at random
it does almost nothing, since the victim keeps every resource and buys the
moment the window closes. That makes it a skill-expressive attack rather than a
stat-check, which is the kind the kit still lacks.

Duration is the whole mechanic. A permanent lock is not a debuff, it is a loss
condition, so this effect is **active-attack only** — the first effect whose
`hosts` excludes `passiveAttack` on purpose (see §1 and Decisions).

---

## Answer to the question this plan came from

_"What happens when an active attack has a debuff effect but no `durationSec`,
or a `durationSec` of `0`?"_ — three layers already stop it, and the new effect
inherits all three by joining the debuff family (§1):

1. [schema.ts:93](../../shared/src/tree/schema.ts#L93) declares
   `durationSec: z.number().positive().optional()`, so a `0` or negative fails
   to decode from the file.
2. [`validateModeDefinition`](../../shared/src/modes/index.ts#L568-L579) throws
   at boot on a debuff effect with no `durationSec`, a `durationSec` with no
   debuff effect, and a non-positive `durationSec` — for programmatically built
   modes that never go through the schema.
3. [`getAttackDurationSec`](../../shared/src/attacks.ts#L273-L277) resolves an
   undefined `durationSec` to `0`, and
   [`resolveAttackStrike`](../../shared/src/attacks.ts#L533-L541) pushes a
   window only when the resolved duration is above zero. The one legitimate
   runtime path to zero — a `duration` attackStat with a negative offset
   pulling the window under the floor — lands the strike, charges the prepare
   cost, opens nothing, and any steal effects on the same attack still fire.

The design intent, stated in the code's comments: on an active attack a debuff
_is_ its window. "No duration" has no meaning, so it is an authoring error, not
"apply forever" and not "apply once". Both the validator's ref-type list
([`DEBUFF_EFFECT_TYPES`](../../shared/src/modes/index.ts#L80)) and the strike's
output-kind test ([`isDebuffOutput`](../../shared/src/attacks.ts#L452)) are
closed lists naming exactly `enemyProductionModifier` / `enemyCostModifier` and
their outputs. **An effect not added to both lists gets none of this** — its
attack would be authorable with no window, land, and silently do nothing. That
is the trap §1 exists to step around.

---

## What already exists (verified)

- **The window lifecycle is complete and effect-agnostic.**
  `resolveAttackStrike` opens one `ActiveDebuff` per attack when any debuff
  output is present ([attacks.ts:499-541](../../shared/src/attacks.ts#L499-L541));
  [`attacksInForce`](../../shared/src/modes/index.ts#L1304) is the single walk
  both collectors share (unlocked passive attacks, then open windows, expiry
  judged at read time); the server sweeps expired windows in
  [`resolveDueAttacks`](../../server/src/match.ts#L562-L569) and clears them
  at round end ([match.ts:901-902](../../server/src/match.ts#L901-L902));
  `attackBlockReason` refuses re-activation with `'already-active'`
  ([attacks.ts:363](../../shared/src/attacks.ts#L363)); the `duration`
  attackStat scales and offsets the window
  ([attacks.ts:273-277](../../shared/src/attacks.ts#L273-L277)); and
  `DebuffAttackEvent` ([messages.ts:158](../../shared/src/messages.ts#L158))
  already produces the "debuffed for 12s" toast pair
  ([game.ts:876-885](../../client/src/game.ts#L876-L885)). None of it asks
  _which_ debuff the window carries.
- **State-carried, server-stamped projection is the proven transport.**
  `PlayerState.incomingCostFactors`
  ([types.ts:202](../../shared/src/types.ts#L202)) is stamped by
  [`syncCostFactors`](../../server/src/match.ts#L428-L437) before every action
  batch, before the bot's actions, and before every broadcast, precisely so
  client prediction and server validation read the same numbers. Plan 33 §2
  makes the desync argument for why this beats threading a parameter; it
  applies verbatim here, and more so — a lock the client doesn't know about
  means a predicted purchase that snaps back on the next snapshot.
- **Every purchase path funnels through two block-reason helpers.**
  [`purchaseBlockReason`](../../shared/src/purchase-validation.ts#L44) and
  [`generatorBlockReason`](../../shared/src/purchase-validation.ts#L86) are the
  server's validators ([match.ts:449](../../server/src/match.ts#L449),
  [:458](../../server/src/match.ts#L458), [:504](../../server/src/match.ts#L504),
  [:509](../../server/src/match.ts#L509)) and the simulator's
  ([simulation/apply.ts:71-84](../../shared/src/simulation/apply.ts#L71-L84)),
  which classifies `'unaffordable'` as transient and everything else as
  permanent ([apply.ts:44](../../shared/src/simulation/apply.ts#L44)). The
  reason vocabulary is a closed union, so adding a member is compiler-checked.
- **The client re-implements the rules inline rather than calling the helper.**
  `doBuy` ([game.ts:482-516](../../client/src/game.ts#L482-L516)),
  `doBuyGenerator` / `doBuyGeneratorMax`
  ([game.ts:519-553](../../client/src/game.ts#L519-L553)), the reconcile replay
  ([game.ts:725-770](../../client/src/game.ts#L725-L770)), `canBuy`
  ([helpers.ts:146](../../client/src/ui/helpers.ts#L146)), the `C` buy-all
  hotkey ([hotkeys.ts:128-146](../../client/src/ui/hotkeys.ts#L128-L146)), and
  the generator card's `affordable` / `maxAffordable`
  ([generators-panel.ts:133-136](../../client/src/ui/panels/generators-panel.ts#L133-L136))
  each list the checks by hand. Plan 38 added `hasAttackSlotsFor` to every one
  of them ([helpers.ts:140](../../client/src/ui/helpers.ts#L140) is its
  client-side face). This is the sweep the lock repeats.
- **The bot advances its plan on _emitting_ a buy, not on it landing.**
  [`advancePlan`](../../server/src/bot.ts#L227-L240) checks affordability, pushes
  the `buy`, and increments `planIndex` in the same breath;
  [`buyGenerators`](../../server/src/bot.ts#L247) is stateless per tick and is
  fine. Today that is safe because every reason the server could refuse a buy
  the bot can afford is one the bot already checks. A lock breaks that: a locked
  bot would emit the buy, the server would drop it, and the bot would step past
  the upgrade for good — the same class of bug plan 33 fixed for inflation. §4
  gives the bot the lock check.
- **`OpponentView` is built field-by-field**
  ([messages.ts:180](../../shared/src/messages.ts#L180)), so a new `PlayerState`
  field leaks no intel by default.
- **The espionage panel has an ungated "Enemy Attacks" section**
  ([espionage-panel.ts:102-124](../../client/src/ui/panels/espionage-panel.ts#L102-L124))
  that already explains incoming cost inflation line by line from
  `incomingCostFactors`. It is the natural home for "your purchases are locked
  for 8s".
- **The editor's picker follows `hosts`** and groups by a presentation table
  ([effects-editor.ts:539-563](../../client/src/dev/editor/effects-editor.ts#L539-L563));
  a type not named there falls into "Other" rather than vanishing.

---

## Approach

### 1. The effect and its output — a third member of the debuff family

New seed effect `enemyPurchaseLock` in `shared/src/effects/seed/`, registered
in [effects/index.ts](../../shared/src/effects/index.ts):

```ts
const schema = z.strictObject({
  /** `upgrades`, `generators`, or `purchases` for both. */
  target: z.enum(['upgrades', 'generators', 'purchases']),
})
```

A real enum rather than a catalog string: unlike `enemyCostModifier` there is
no per-entity form (see Decisions 3), so the three values are the whole
vocabulary and the editor form gets a dropdown from the schema for free. The
two scope words match `ALL_UPGRADES_TARGET` / `ALL_GENERATORS_TARGET` in
[addressable.ts](../../shared/src/effects/addressable.ts#L141-L143) so the same
authored word means the same thing across the two attack effects.

`apply` is state-independent and echoes a **new output kind**, added to the
`EffectOutput` union ([effects/types.ts:363](../../shared/src/effects/types.ts#L363)):

```ts
export interface EnemyPurchaseLockOutput {
  readonly kind: 'enemyPurchaseLock'
  /** Which purchase scopes the victim is barred from. */
  readonly scopes: readonly CostScope[] // ['upgrade'] | ['generator'] | both
}
```

Not an `EnemyCostOutput` with an infinite factor. It is tempting — `costFactor:
Infinity` would make every price unaffordable through the existing seams with
zero new plumbing — but it fails on three counts: `MAX_ATTACK_PARAM` and the
`power` scaling in `scaleCostFactor` would turn `Infinity` into `NaN` or a
finite number depending on the attacker's upgrades; the victim's cards would
quote `∞ 🪵 ⬆` instead of "locked"; and the simulator would classify it as a
_transient_ `'unaffordable'` and keep waiting for income that will never
suffice. The distinct kind is what lets every consumer say "locked" rather than
"too expensive".

```ts
export const enemyPurchaseLock: EffectDef<EnemyPurchaseLockParams> = {
  schema,
  apply,
  // Active only. A passive lock would bar the victim from buying for the whole
  // round — not a debuff but a loss condition — so the host declaration
  // forbids it and the editor never offers it there.
  hosts: ['activeAttack'],
}
```

**Join both closed lists.** `'enemyPurchaseLock'` goes into
`DEBUFF_EFFECT_TYPES` ([modes/index.ts:80](../../shared/src/modes/index.ts#L80))
and `'enemyPurchaseLock'` (the output kind) into `isDebuffOutput`
([attacks.ts:452](../../shared/src/attacks.ts#L452)). With those two lines the
effect gets, with no further code: the boot-time "debuff needs a `durationSec`"
rule; the window push in `resolveAttackStrike`; `'already-active'`; the
`duration` attackStat; the debuff toast pair; the sweep. The three validator
messages that name the two existing effects
([modes/index.ts:570](../../shared/src/modes/index.ts#L570),
[:574](../../shared/src/modes/index.ts#L574)) should be reworded to derive from
the set rather than hard-code the names, so a fourth member doesn't need to
touch them.

### 2. Collection: the third `attacksInForce` consumer

```ts
/**
 * The purchase scopes `attacker`'s attacks currently bar the opponent from,
 * gathered from `attacksInForce` (open windows only, since the effect is
 * active-only). Deduplicated — two windows locking upgrades is one lock.
 */
export function collectEnemyPurchaseLocks(
  attacker: Readonly<PlayerState>,
  mode: ModeDefinition,
): CostScope[]
```

Beside `collectEnemyDebuffs` and `collectEnemyCostFactors` in
[modes/index.ts](../../shared/src/modes/index.ts#L1320-L1359), same walk, same
shape. **No `power` scaling** — a lock has no magnitude. `power` is the one
attack stat that means nothing here; `duration`, `prepareCost` and
`prepareTime` all apply. The stat preview in the editor and the attack card's
stat line should therefore skip `power` for an attack whose only effect is a
lock (open question 2 covers whether to enforce that at boot).

### 3. Transport: `PlayerState.incomingPurchaseLocks`

```ts
// PlayerState — beside incomingCostFactors
/**
 * Purchase scopes the opponent's open attack windows currently bar this player
 * from, stamped by the server (see `collectEnemyPurchaseLocks`). Absent when
 * none, which is the default. Read by every purchase path — validation,
 * prediction, the card — so client and server refuse the same buys.
 */
incomingPurchaseLocks?: CostScope[]
```

Stamped inside the existing `syncCostFactors`
([match.ts:428](../../server/src/match.ts#L428)) — rename it
`syncIncomingEffects` or leave the name and widen its doc; either way it is
already called at every point a purchase is about to be judged or shown, and a
second loop over `attacksInForce` per player per stamp is negligible. Absent
rather than empty, matching its siblings. `clonePlayerState`
([game.ts:930](../../client/src/game.ts#L930)) copies the array;
`EMPTY_PLAYER_STATE` and `probeState` leave it absent.

**Why not read the attacker's `activeDebuffs` directly on the victim's side?**
Because the victim's client never receives the attacker's `PlayerState`, only an
`OpponentView`. Anything the victim must predict has to arrive on their own
state. Same reasoning that put `incomingCostFactors` where it is.

### 4. Validation: two new block reasons, permanent-for-now

[purchase-validation.ts](../../shared/src/purchase-validation.ts):

```ts
export type PurchaseBlockReason =
  | 'unknown'
  | 'maxed'
  | 'prerequisite'
  | 'choice-group'
  | 'attack-slots'
  | 'locked-by-attack' // an enemy window bars upgrade purchases
  | 'unaffordable'

export type GeneratorBlockReason =
  | 'unknown'
  | 'locked'
  | 'locked-by-attack' // an enemy window bars generator purchases
  | 'unaffordable'
```

Placed **after** the structural reasons and **before** `'unaffordable'`: a
player who is locked and also broke should be told they are locked, since that
is the thing they can do nothing about right now. One helper does the check for
both paths:

```ts
export function isPurchaseLocked(state: Readonly<PlayerState>, scope: CostScope): boolean {
  return state.incomingPurchaseLocks?.includes(scope) ?? false
}
```

**Selling is not blocked.** `generatorSellBlockReason` is untouched: the lock
is on _spending_, and barring a sale would let the attack strand a victim who
needs to liquidate. Plan 33 §4 drew the same buy/sell line for inflation.

**Attack activation is not blocked either.** A locked player can still fire
back — `attackBlockReason` doesn't consult the field. Locking attacks too would
make the first lock landed decide the exchange.

**The bot must not step past a locked buy.** `advancePlan`
([bot.ts:227-240](../../server/src/bot.ts#L227-L240)) increments `planIndex`
when it _emits_ a buy, so a buy the server drops for a lock would be skipped
forever. Add `if (isPurchaseLocked(state, 'upgrade')) return` at the top, before
the affordability check, so the plan holds its place until the window closes.
`buyGenerators` re-derives from state every tick and only needs the same guard
to save emitting doomed actions. `syncCostFactors` already runs before
`processBotActions`, so the bot reads a fresh stamp.

**Simulator classification.** `classify` in
[simulation/apply.ts:44](../../shared/src/simulation/apply.ts#L44) treats every
non-`unaffordable` reason as permanent and gives up on the action. The simulator
has no opponent and no attacks (deferred since plan 29), so `incomingPurchaseLocks`
is never set there and the reason can never arise; but the classification is
wrong in principle — a lock is _transient_ (wait for the window) — so add it to
the transient branch now, with a comment, rather than leave a landmine for the
day attacks reach the simulator.

### 5. Client: the plan-38 sweep, one more predicate

Every site that hand-lists the purchase rules gains the lock check. Compiler
help is limited (the rules are inline booleans, not a shared call), so the list
is the contract:

| Site                                                                                                          | Change                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `doBuy` ([game.ts:482](../../client/src/game.ts#L482))                                                        | `if (isPurchaseLocked(state.player, 'upgrade')) return` after the slot check                   |
| `doBuyGenerator`, `doBuyGeneratorMax` ([game.ts:519-553](../../client/src/game.ts#L519-L553))                 | same, `'generator'`                                                                            |
| reconcile `case 'buy'` / `case 'buy_generator'` ([game.ts:725-770](../../client/src/game.ts#L725-L770))       | check against `reconciled` — a replayed buy the server will refuse is dropped, not flickered   |
| `canBuy` ([helpers.ts:146](../../client/src/ui/helpers.ts#L146))                                              | `&& !isPurchaseLocked(state.player, 'upgrade')`; covers the `C` hotkey and the tree node class |
| generator card nums ([generators-panel.ts:133-136](../../client/src/ui/panels/generators-panel.ts#L133-L136)) | `affordable` and `maxAffordable` gated; new `lockedByAttack` display flag beside `locked`      |

Rendering, all additive:

- **Tree nodes** — a new state class `locked-by-attack` in
  [components.ts:165-179](../../client/src/ui/components.ts#L165-L179), styled
  like `too-expensive` with a 🔒 badge, so the whole tree reads as embargoed at
  a glance. Nodes stay clickable (the popup opens; the buy button inside is
  disabled with the reason), matching the existing "never `disabled`" rule.
- **Generator cards** — buy buttons show `🔒 Locked Ns` instead of the price,
  the same slot `🔒 Locked` uses for a not-yet-unlocked generator; sell stays
  live. The countdown needs the window's expiry, which is open question 1.
- **Espionage panel** — a line in the ungated "Enemy Attacks" section: `🔒 Your
upgrades and generators are locked for N.Ns.` Same placement and reasoning as
  the cost-inflation lines.
- **Toasts** — nothing new. The strike emits the existing `kind: 'debuff'` event
  pair and the incoming toast already says `debuffed for 12s`. Consider
  specialising the copy to `purchases locked for 12s` when the attack's effects
  are all locks; a flavor-level description already exists on the attack card.
- **Attacker side** — `Active for N.Ns` on the attack card is already there.

### 6. Boot validation

All three duration rules arrive with the `DEBUFF_EFFECT_TYPES` entry. Two
additions in the per-attack loop
([modes/index.ts:530](../../shared/src/modes/index.ts#L530)):

- `enemyPurchaseLock` on a passive attack → the generic `checkHost` loop throws
  already, since the host list excludes it. Add a test, not code.
- Two `enemyPurchaseLock` refs on one attack whose scopes overlap → throw, as
  authored dead weight (the collector dedupes, so it is harmless, but the
  editor should not let it stand).

### 7. Dev editor

- `EFFECT_GROUPS` "Offense" gains `'enemyPurchaseLock'`
  ([effects-editor.ts:557](../../client/src/dev/editor/effects-editor.ts#L557)).
- The `target` enum renders as a dropdown from the schema; no
  `effectFieldOptions` entry needed.
- The attack row's stat preview
  ([model.ts](../../client/src/dev/editor/model.ts)) omits `power` for a
  lock-only attack (see open question 2).
- Rename/delete integrity ([model.ts:565](../../client/src/dev/editor/model.ts#L565),
  [:633](../../client/src/dev/editor/model.ts#L633)) needs nothing: the effect
  names no entity id.

---

## Balance note

The lock's value is `stockpile-seconds delayed`, not `resource-seconds lost`.
A victim who was about to spend 500 wood on a tier and is locked for 10s buys
it at t+10 instead of t; the cost to them is ten seconds of the _tier's_ output
plus the compounding on top, and nothing if they were saving anyway. So the
authoring envelope is:

- **Window 6-12s.** Under ~5s the victim doesn't notice; over ~15s a whole-scope
  lock on both scopes starts to read as "you lose".
- **Prepare time short, prepare cost high.** The attack is a timing play — a
  long fuse makes it a guess, and a cheap one makes it spam.
- **Pair it with `accessEnemyData: purchases`** on the same branch of the tree.
  The lock is only skill-expressive if the attacker can _see_ that the victim is
  saving, which is exactly the intel that effect grants. Without it the lock is
  a coin flip and should be priced as one.
- **Prefer single-scope.** `purchases` (both) is the nuclear option; `upgrades`
  alone leaves the victim reinvesting into generators, which keeps them busy
  and keeps the attack survivable.

Since the lock has no magnitude, `power` upgrades do not touch it. Authors
wanting a "stronger lock" reach for `duration`.

---

## Files touched

| File                                                                                       | Change                                                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `shared/src/effects/seed/enemy-purchase-lock.ts`                                           | **New** — schema (`target` enum), `apply`, `hosts: ['activeAttack']`.                                   |
| [shared/src/effects/index.ts](../../shared/src/effects/index.ts)                           | Register `enemyPurchaseLock`.                                                                           |
| [shared/src/effects/types.ts](../../shared/src/effects/types.ts)                           | `EnemyPurchaseLockOutput` + union member; `EffectHost` doc names a third debuff output.                 |
| [shared/src/types.ts](../../shared/src/types.ts)                                           | `PlayerState.incomingPurchaseLocks?: CostScope[]`; `AttackDefinition.durationSec` doc lists the effect. |
| [shared/src/attacks.ts](../../shared/src/attacks.ts)                                       | `isDebuffOutput` accepts `'enemyPurchaseLock'`.                                                         |
| [shared/src/modes/index.ts](../../shared/src/modes/index.ts)                               | `DEBUFF_EFFECT_TYPES` entry; `collectEnemyPurchaseLocks`; overlap rule; messages derived from the set.  |
| [shared/src/purchase-validation.ts](../../shared/src/purchase-validation.ts)               | `'locked-by-attack'` on both reason unions + `isPurchaseLocked`.                                        |
| [shared/src/simulation/apply.ts](../../shared/src/simulation/apply.ts)                     | `'locked-by-attack'` classified transient.                                                              |
| [server/src/match.ts](../../server/src/match.ts)                                           | Stamp `incomingPurchaseLocks` in `syncCostFactors`.                                                     |
| [server/src/bot.ts](../../server/src/bot.ts)                                               | Lock guard in `advancePlan` (hold the plan step) and `buyGenerators`.                                   |
| [client/src/game.ts](../../client/src/game.ts)                                             | Lock check in `doBuy`, `doBuyGenerator(Max)`, both reconcile cases; field in `clonePlayerState`.        |
| [client/src/ui/helpers.ts](../../client/src/ui/helpers.ts)                                 | `isPurchaseLockedByAttack(state, scope)`; `canBuy` gated.                                               |
| [client/src/ui/components.ts](../../client/src/ui/components.ts)                           | `locked-by-attack` node state class.                                                                    |
| [client/src/ui/upgrade-detail.ts](../../client/src/ui/upgrade-detail.ts)                   | Buy button disabled with a "locked by enemy attack" reason.                                             |
| [client/src/ui/panels/generators-panel.ts](../../client/src/ui/panels/generators-panel.ts) | `lockedByAttack` flag; `🔒 Locked` buy buttons, sell untouched.                                         |
| [client/src/ui/panels/espionage-panel.ts](../../client/src/ui/panels/espionage-panel.ts)   | Lock line in "Enemy Attacks".                                                                           |
| [client/src/style.css](../../client/src/style.css)                                         | `.tree-node.locked-by-attack`, `.generator-card.locked-by-attack`.                                      |
| [client/src/dev/editor/effects-editor.ts](../../client/src/dev/editor/effects-editor.ts)   | "Offense" group entry.                                                                                  |
| [docs/DESIGN.md](../DESIGN.md)                                                             | Attack section: the three debuff effects and the active-only host.                                      |

No new action type, no new client→server message, no `STATE_UPDATE` field.

## Data / type changes

- **`PlayerState.incomingPurchaseLocks?: CostScope[]`** — wire-stable, optional,
  server-stamped. Old clients ignore it and predict buys the server refuses,
  which reconciliation corrects on the next snapshot; not silent corruption.
- **New effect output kind** `enemyPurchaseLock`; every existing consumer
  ignores it by construction.
- **Two block-reason unions grow a member.** Exhaustive switches over them (none
  today outside the simulator's string passthrough) would be compiler-flagged.
- **`enemyPurchaseLock` is the first `hosts: ['activeAttack']`-only effect that
  is not a steal.** `EffectHost` docs should say the debuff outputs are "any of
  `enemyModifier`, `enemyCost`, `enemyPurchaseLock`", not "the two".

## Complexity check

- **One effect, one output kind, one collector, one field, two reasons** — each
  a twin of an existing thing. The window machinery is reused untouched, which
  is the payoff of plan 37 having kept it effect-agnostic.
- **The client sweep is the cost**, as it was in plan 38: six sites list the
  purchase rules by hand. Worth noting for a later cleanup that `canBuy` and
  `doBuy` could both call `purchaseBlockReason` directly — the helper already
  takes `(state, id, upgradeMap, mode)` and the client has all four — which
  would make this the last such sweep. Out of scope here.
- **Deliberately NOT built:** per-entity locks (`upgrade:<id>`), a lock on
  attack activation, a lock on selling, a passive lock, a `power`-scaled partial
  lock (e.g. "every other purchase fails"), and any authoring on the idler tree.

---

## Tests

**shared/tests/effects.test.ts** (extend)

- `enemyPurchaseLock` parses each of the three targets to the right scopes and
  rejects any other string; placement on a passive attack fails the host check.

**shared/tests/flavor.test.ts** (extend)

- An active attack with a lock and no `durationSec` throws (the inherited rule);
  a lock with a `durationSec` and no other effect is accepted; two overlapping
  locks on one attack throw.

**shared/tests/attacks.test.ts** (extend)

- `resolveAttackStrike` on a lock-only attack pushes one window and returns one
  `kind: 'debuff'` result; a lock beside a steal does both and still pushes one
  window; `'already-active'` blocks re-activation while the window is open.

**shared/tests/purchase-lock.test.ts** (new — the suite that protects the feature)

- `collectEnemyPurchaseLocks` gathers only from open windows, dedupes two
  windows on the same scope, and returns `[]` once `gameSec` passes expiry.
- `purchaseBlockReason` returns `'locked-by-attack'` for a locked scope ahead of
  `'unaffordable'`, and `null` for the other scope; same for
  `generatorBlockReason`; `generatorSellBlockReason` is unaffected.
- The simulator classifies `'locked-by-attack'` as transient.

**server/tests/match.test.ts** (extend)

- A lock attack activated, prepared, and landed: the victim's `buy` and
  `buy_generator` actions are dropped during the window and accepted after it;
  `sell_generator` and `activate_attack` succeed throughout; the stamp appears
  on the victim's broadcast state, never the attacker's, and is absent once the
  window closes.
- The bot's `advancePlan` does **not** advance past a locked step: after a lock
  window over the bot, the planned upgrade is still bought once the window
  closes (the regression this plan's bot change guards).

**client/tests/** — `purchase-lock.test.ts` (node tier): `canBuy` false and the
tree-node class `locked-by-attack` under a lock; generator card quotes
`🔒 Locked` on buy and a live sell; the espionage line reads correctly for each
scope. A DOM test that `doBuy` queues nothing while locked and the reconcile
replay drops a stale predicted buy.

---

## Open questions

1. **Victim-side countdown.** The victim knows _that_ they are locked but not
   for how long — `incomingPurchaseLocks` is a scope list with no expiry, for
   the same reason `STATE_UPDATE.debuffs` has none (plan 37, open question 1).
   Options: (a) ship without, the incoming toast states the duration and the
   buttons just say `🔒 Locked`; (b) stamp `incomingPurchaseLocksUntilSec` (the
   latest expiry) beside the list, one extra number; (c) make the list
   `{ scope, untilSec }[]`. **Proposed: (b)** — a lock is the first debuff where
   the victim's decision ("do I wait or reinvest elsewhere") turns on the
   remaining time, so the countdown earns its number where the production
   debuff's didn't. It also resolves plan 37's open question for this effect
   only, without touching `debuffs`.
2. **Should `power` on a lock-only attack be a boot error?** A `power`
   attackStat aimed at an attack whose effects are all locks is dead weight,
   exactly like `duration` on a window-less attack, which plan 37 rejects at
   boot ([modes/index.ts:281](../../shared/src/modes/index.ts#L281)). Symmetry
   says reject it. Proposed: yes, same message shape, and the editor's stat
   picker narrows accordingly.
3. **Both scopes at once — enum value or two refs?** `purchases` as a third
   enum value is one ref and one dropdown pick; requiring two refs
   (`upgrades` + `generators`) keeps the enum at two and makes the overlap rule
   in §6 unnecessary. Proposed: keep `purchases`; the overlap rule is three
   lines and the author's intent is clearer in one ref.
4. **Does a lock mid-`buy-upgrade` goal need special handling?** The trophy is
   an upgrade; a lock delays it like any other. Under that goal a
   well-timed lock is decisive by design. No special case proposed, but the
   balance note should be read with that goal in mind.

---

## Deferred

- **Simulator and bot support for attacks** — still owed since plan 29; §4 only
  prepares the classification.
- **Consolidating the client's inline purchase rules onto `purchaseBlockReason`**
  so the next block reason needs no six-site sweep.
- **Authoring on the idler tree** — separate pass, in `/dev.html`, alongside an
  `accessEnemyData: purchases` node on the same branch (see Balance note).
