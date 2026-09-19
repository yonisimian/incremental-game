# 38 — Attack limit: a budget on how many attacks you can hold

## Status: Implemented — design A (purchase gate)

Third of the three attack-extension plans (36 → 37 → 38), and the most expensive
of them. Two designs are written up below: a **purchase gate** (recommended,
small) and an **equip system** (what "limit" usually means in an idle game, and
roughly five times the work). Design A shipped; B stays deferred until playtesting
says swapping _during_ a round is the interesting decision.

### Decisions taken (2026-09-19)

Resolved against the open questions and the design's defaults before coding:

| #   | Question                               | Decision                                                                                                                                                                                                                           |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Per-kind or pooled budget              | **Per kind** (`active` / `passive`), as specified.                                                                                                                                                                                 |
| 2   | Must attack-unlock nodes be pure       | **No.** A node may carry an unlock and a production bonus; at the cap it is blocked whole. No boot rule.                                                                                                                           |
| 3   | Is a limit of 0 representable          | **Yes, by omission.** A kind is capped once _any_ `attackSlots` effect in the mode names it (mode or upgrade). A mode granting slots only from an upgrade caps the kind at 0 until it is bought. `value` stays a positive integer. |
| 4   | Slots vs plan-36 power nodes           | No decision now; a `/dev.html` balance question.                                                                                                                                                                                   |
| 5   | Starting-effect attacks consume a slot | **Yes**, as written; the boot check below guards the authored base.                                                                                                                                                                |
| 6   | Multi-attack upgrades                  | **All-or-nothing**, as written.                                                                                                                                                                                                    |
| 7   | How validation reaches the mode        | **Added a `mode` parameter** to `purchaseBlockReason` _and_ its `isValidPurchase` wrapper (the server calls the wrapper).                                                                                                          |
| 8   | No-`attackSlots` mode                  | **Uncapped** (`Infinity`).                                                                                                                                                                                                         |
| 9   | Reconcile replay                       | **Also checks slots** — the fourth client parity site the original write-up missed.                                                                                                                                                |
| 10  | Idler base cap                         | **Authored now**: 3 active, 4 passive, as `startingEffects`.                                                                                                                                                                       |
| 11  | Slot-blocked node style                | **Reuses `locked`.**                                                                                                                                                                                                               |

One refinement to A3 while implementing: the budget check counts any slots the
upgrade _itself_ grants, so a node that adds a slot and fills it in one purchase
("+1 active slot, unlock Raid") is legal at the cap.

### Idler slot upgrades

Three free nodes under the attack-panel unlock (`a-unlock`) raise the base:
`slot-active-1` (+1 active), `slot-passive` (+2 passive), and `slot-active-2`
(+1 active, requires `slot-active-1`) — so the idler's ceiling is 5 active and 6
passive.

### Note: `node-7` vs the passive cap

The idler's placeholder node `node-7` unlocks **five** passive attacks at once
(`less-click-power`, `less-highlight-power`, `less-click-power-add`, `a8`, `a9`).
Under the base of 4 it is unbuyable (all-or-nothing, decision 6); with
`slot-passive` owned it fits only while at most one other passive is held. If it
is meant to be freely reachable, split it or raise the passive budget.

Reads better after [36 — attack stat upgrades](36-attack-stat-upgrades.md), which
is what gives a capped player something to spend on: a limit is only interesting
when _deepening_ an attack competes with _acquiring_ one.

---

## Goal

Cap how many attacks a player can hold — separately per kind (`active` /
`passive`) — and let upgrades raise the cap. Today an attack tree is pure
breadth: every `unlockAttack` node you can afford is a node you take, and the
only question is order. A limit turns the tree into a choice, and makes the attack
panel a loadout rather than an inventory.

---

## Where it stands today

Unlocking is **derived, monotonic, and choice-free**:

- [`isAttackUnlocked(state, mode, attackId)`](../../shared/src/modes/index.ts#L685)
  is `isGranted(state, attackGate(mode, attackId))` — a reverse index over every
  `unlockAttack` effect in the mode, built once per mode and cached in a `WeakMap`
  ([unlock-gates.ts](../../shared/src/unlock-gates.ts)). A gate is granted by an
  **owned upgrade** or by the mode's **starting effects** (the tree file's
  `startingEffects`, which become `ModeDefinition.effects`
  — [codec.ts:208-212](../../shared/src/tree/codec.ts#L208-L212)), the latter
  unconditionally for the whole round.
- [`unlockedAttacks(state, mode)`](../../shared/src/modes/index.ts#L694) is the
  one list every consumer reads: the panel
  ([attack-panel.ts:117-124](../../client/src/ui/panels/attack-panel.ts#L117-L124)),
  `collectEnemyDebuffs`
  ([modes/index.ts:1100](../../shared/src/modes/index.ts#L1100)),
  `collectEnemyCostFactors`
  ([modes/index.ts:1131](../../shared/src/modes/index.ts#L1131)), and
  `attackBlockReason` via `isAttackUnlocked`
  ([attacks.ts:58](../../shared/src/attacks.ts#L58)).
- There is **no player-owned attack state** beyond `pendingAttacks`
  ([types.ts:171-172](../../shared/src/types.ts#L171-L172)).

And one thing that matters for costing either design: **purchase validation is
implemented twice.** The shared, authoritative form is
[`purchaseBlockReason(state, upgradeId, upgradeMap)`](../../shared/src/purchase-validation.ts#L37)
(used by [match.ts:448](../../server/src/match.ts#L448),
[match.ts:502](../../server/src/match.ts#L502) and
[simulation/apply.ts:71](../../shared/src/simulation/apply.ts#L71)), but the
client does **not** call it — `doBuy`
([game.ts:481-511](../../client/src/game.ts#L481-L511)) re-checks `isMaxed`,
`isPrerequisiteSatisfied`, `isChoiceGroupAvailable` and affordability inline, and
so do `canAfford` ([helpers.ts:84-90](../../client/src/ui/helpers.ts#L84-L90)) and
the tree-node state derivation
([components.ts:163-173](../../client/src/ui/components.ts#L163-L173)). Any new
purchase rule has to land in all four places or the client will predict a buy the
server rejects.

Finally, worth knowing before building anything: **choice groups already express a
small limit.** `choiceGroup` / `isChoiceGroupAvailable`
([upgrade-groups.ts](../../shared/src/upgrade-groups.ts)) make a set of sibling
nodes mutually exclusive with zero new code. "Pick one of these three attacks" is
already authorable today. A limit is the generalization — a budget across the
whole tree rather than within one cluster — and if the design intent is really
"one of these three", stop here and author a choice group.

---

## Design A — the purchase gate (recommended)

**The rule:** an upgrade that would unlock an attack is unbuyable once you already
hold your limit of that kind. Unlocking stays derived and monotonic; the cap turns
it into an irreversible commitment.

### A1. The cap: an `attackSlots` effect

New seed effect, default hosts (`mode` + `upgrade`), so the base cap is authored
as a starting effect and raises are ordinary tree nodes:

```ts
const schema = z.strictObject({
  /** Which kind of attack this budget covers. */
  attackKind: z.enum(['active', 'passive']),
  /** Slots granted, per owned level. */
  value: z.number().int().positive(),
})
```

Output `{ kind: 'attackSlots', attackKind, value }`, collected by:

```ts
export function attackLimit(state, mode, kind: AttackKind): number
```

Same collector shape as
[`collectBatteryParams`](../../shared/src/highlight-battery.ts#L102): walk
`mode.effects` at owned 1, then every owned upgrade at its owned count, sum
`value × owned`. Additive only — a multiplicative op on a small integer count
buys nothing but rounding questions.

A mode that authors no `attackSlots` effect at all has **no limit** (`Infinity`),
so the mechanic is opt-in per mode and the idler keeps working untouched until
someone authors a base. That matches how `panelUnlock` treats an ungated panel
(available by default) rather than how attacks treat an ungated attack (hidden).

### A2. The count, and what it counts

`unlockedAttacks(state, mode)` filtered by kind — i.e. **attacks held**, not
unlock upgrades owned. Two consequences to accept deliberately:

- An attack granted by the mode's `startingEffects` **consumes a slot**. It is an
  attack the player holds, and exempting it would make the cap mean different
  things in different modes. The authored base must account for it.
- Two upgrades unlocking the same attack cost one slot, not two — which is right,
  and falls out of counting attacks.

### A3. The block

`PurchaseBlockReason` gains `'attack-slots'`, checked after `'choice-group'` and
before `'unaffordable'` in
[`purchaseBlockReason`](../../shared/src/purchase-validation.ts#L37) — permanent
reasons first, transient last, per the function's stated ordering rule:

```ts
if (!hasAttackSlotsFor(state, def, mode)) return 'attack-slots'
```

where `hasAttackSlotsFor` runs the upgrade's `unlockAttack` refs, keeps the
attacks not already unlocked, buckets them by kind, and requires
`held(kind) + adding(kind) <= attackLimit(state, mode, kind)` for each kind. An
upgrade unlocking two attacks with one slot free is blocked outright
(all-or-nothing) — a partial unlock is not representable, since the gate is
derived from the upgrade being owned.

**This needs `mode`, which `purchaseBlockReason` does not currently take.** It
takes `upgradeMap` (a lookup index). Options:

1. **Add a `mode: ModeDefinition` parameter** (recommended). Three shared/server
   call sites, all of which already hold a `ModeDefinition`
   (`this.modeDef` in match.ts, `mode` in the simulator). Keeps the "reason and
   boolean can never drift" invariant the file is built around
   ([purchase-validation.ts:8-14](../../shared/src/purchase-validation.ts#L8-L14)).
2. A separate `attackSlotBlockReason` called alongside. Cheaper diff, but it
   creates exactly the second source of truth that file's header argues against —
   and the client, which already duplicates these checks, would be the first to
   drift.

Take option 1, and mirror the check into the three client sites listed above. The
tree-node state derivation
([components.ts:163-173](../../client/src/ui/components.ts#L163-L173)) composes
its own booleans rather than reading a reason, so the cheapest honest fix there is
to add one more boolean beside `choiceBlocked` and reuse the `locked` state class.

### A4. UI

- **Attack panel** — a slots line per section heading: `Active 2 / 3`,
  `Passive 1 / 2`. `renderSection`
  ([attack-panel.ts:106](../../client/src/ui/panels/attack-panel.ts#L106)) already
  takes a heading string, so this is a formatting change plus `attackLimit` calls.
  When a mode has no cap (`Infinity`), print nothing.
- **Upgrade detail popup** — "No attack slots left" for a node blocked this way;
  otherwise a maxed-out player sees a node that looks affordable and does nothing
  on click, which reads as a bug (the same reasoning that put
  [`INFLATED_COST_MARKER`](../../client/src/ui/helpers.ts#L93) on inflated
  prices).
- **The slot-granting upgrade** needs its own flavor text; nothing derives it.

### A5. Boot validation

- An `attackSlots` effect with `value <= 0` or a non-integer → schema rejects.
- A mode that authors `attackSlots` for one kind but not the other: legal
  (uncapped kind stays `Infinity`), and worth an explicit test so it is a decision
  rather than an accident.
- **A mode whose base cap is below the number of attacks its own
  `startingEffects` grant → throw.** Otherwise the player starts over budget, in a
  state the purchase gate can never repair.

### A6. What A costs, honestly

| Piece                                                    | Size                                   |
| -------------------------------------------------------- | -------------------------------------- |
| `attackSlots` effect + output + registration             | small, fully patterned                 |
| `attackLimit` collector                                  | small, transplanted from the battery   |
| `purchaseBlockReason` param + rule                       | small, but touches 3 call sites        |
| Client parity in `doBuy` / `canAfford` / tree node state | **the real work** — 3 duplicated paths |
| Panel + detail UI                                        | small                                  |
| Editor picker (`attackKind` is an enum → free)           | none                                   |

No new wire field, no new action, no new `PlayerState` field, no reconciliation
work, no server tick work.

---

## Design B — equip slots (respec, and five times the work)

**The rule:** unlock upgrades grant _candidates_; the player equips up to N of
them and can swap during the round.

What it requires that A does not:

1. **New `PlayerState` field** `equippedAttacks: string[]` — wire-stable,
   reasoned about during reconciliation, so it belongs on `PlayerState` beside
   `pendingAttacks` rather than in `meta`
   ([types.ts:173-188](../../shared/src/types.ts#L173-L188)).
2. **New action type** `equip_attack` (and unequip) in `ActionType`
   ([types.ts:229-230](../../shared/src/types.ts#L229-L230)) with its payload
   field, server-side validation in `processActions`
   ([match.ts:438](../../server/src/match.ts#L438)), and a new
   `equipBlockReason` family.
3. **Client prediction** — a `PredictedAction` member
   ([game.ts:152-158](../../client/src/game.ts#L152-L158)), a `doEquipAttack`
   with an optimistic apply, and a replay case in the reconcile switch
   ([game.ts:709-767](../../client/src/game.ts#L709-L767)).
4. **Every read path changes meaning.** `isAttackUnlocked` becomes "granted _and_
   equipped", or a second predicate `isAttackEquipped` has to be threaded through
   `collectEnemyDebuffs`, `collectEnemyCostFactors`, `attackBlockReason` and the
   panel. The first option is a silent behavior change to a function four
   subsystems already call; the second is four call sites and a permanent
   "which one did you mean" hazard.
5. **Panel rework** — the attack panel becomes two lists (owned candidates,
   equipped loadout) with equip/unequip affordances, not the flat list it is now.
6. **Lifecycle answers** the engine currently has no opinion on: unequipping an
   attack with a strike in flight (drop it and refund? keep it, since it was paid
   for?), unequipping mid-window once
   [plan 37](37-duration-active-attacks.md) lands (the window was paid for, so it
   should persist — meaning `activeDebuffs` must be gathered independently of
   equip state, which is already how that plan specifies it), and whether an
   equipped passive attack that is swapped out mid-round refunds anything.
7. **Bot support** — `server/src/bot.ts` never touches attacks at all, so a bot
   would hold zero equipped attacks and the mechanic would be invisible in bot
   matches.

And the design problem underneath all of it: **if swapping is free and instant,
the limit constrains almost nothing** — the player equips whatever the moment
calls for and pays only attention. Making it bite means a swap cost, a cooldown,
or a lockout, each of which is another field, another block reason, another
countdown in the UI. That is a mechanic in its own right, not a cap.

---

## Recommendation

Ship **A**. It delivers the strategic content of the idea — a real budget, raised
by upgrades, forcing depth-vs-breadth — for a fraction of the work, and inside a
60-second round the absence of respec is closer to a feature than a limitation:
the loadout _is_ the build, chosen under time pressure.

Revisit **B** only if playtesting says the interesting decision is _swapping
during_ a round rather than _committing before_ it. Nothing in A blocks B later:
B's `equippedAttacks` would subsume A's counter, and A's `attackSlots` effect
becomes B's slot count unchanged.

---

## Files touched (design A)

| File                                                                               | Change                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------- |
| `shared/src/effects/seed/attack-slots.ts`                                          | **new** — schema + `apply`              |
| [shared/src/effects/index.ts](../../shared/src/effects/index.ts)                   | register `attackSlots`                  |
| [shared/src/effects/types.ts](../../shared/src/effects/types.ts)                   | `AttackSlotsOutput` + union + doc       |
| [shared/src/attacks.ts](../../shared/src/attacks.ts)                               | `attackLimit`, `hasAttackSlotsFor`      |
| [shared/src/purchase-validation.ts](../../shared/src/purchase-validation.ts)       | `'attack-slots'` reason, `mode` param   |
| [shared/src/modes/index.ts](../../shared/src/modes/index.ts)                       | base-cap-vs-starting-unlocks validation |
| [shared/src/simulation/apply.ts](../../shared/src/simulation/apply.ts)             | pass `mode` through                     |
| [server/src/match.ts](../../server/src/match.ts)                                   | pass `this.modeDef` at both call sites  |
| [client/src/game.ts](../../client/src/game.ts)                                     | slot check in `doBuy`                   |
| [client/src/ui/helpers.ts](../../client/src/ui/helpers.ts)                         | slot check in `canAfford`               |
| [client/src/ui/components.ts](../../client/src/ui/components.ts)                   | slot-blocked node state                 |
| [client/src/ui/upgrade-detail.ts](../../client/src/ui/upgrade-detail.ts)           | "No attack slots left"                  |
| [client/src/ui/panels/attack-panel.ts](../../client/src/ui/panels/attack-panel.ts) | `Active 2 / 3` section headings         |

---

## Tests (design A)

**shared/tests/attacks.test.ts** (extend)

- `attackLimit`: no `attackSlots` anywhere → `Infinity`; a mode-level effect sets
  the base; an owned upgrade adds `value × owned`; per-kind budgets are
  independent.
- `hasAttackSlotsFor`: blocked at the cap; allowed when the upgrade's attack is
  _already_ unlocked (no double charge); all-or-nothing for a two-attack upgrade
  with one slot free; unaffected by the other kind's budget.

**shared/tests/upgrade-groups.test.ts / a purchase-validation test** (extend)

- `purchaseBlockReason` returns `'attack-slots'` at the cap and reports the more
  fundamental reason first when an upgrade is _also_ maxed / prerequisite-blocked
  / choice-blocked.
- An upgrade with no `unlockAttack` effect is never slot-blocked.

**shared/tests/flavor.test.ts** (extend) — a mode whose base cap is below its own
starting unlocks throws; a mode capping only one kind loads.

**server/tests/match.test.ts** (extend) — the server rejects a `buy` action for a
slot-blocked upgrade (and the client's optimistic purchase is reconciled away).

**client/tests/** — `game.test.ts`: `doBuy` refuses a slot-blocked upgrade;
`components.test.ts` / `helpers.test.ts`: the node renders locked and the detail
states the reason. A DOM test for the `Active 2 / 3` heading.

---

## Open questions

1. **Should an `unlockAttack` node be forbidden from carrying production
   effects?** Once attack unlocks are slot-gated, an upgrade that grants both an
   attack and a production bonus becomes unbuyable at the cap — silently costing
   the player the bonus too. Cleanest answer is an authoring rule ("attack-unlock
   nodes are pure") enforced in `validateModeDefinition`; the risk is that it is
   too strict for a "warlord" node that legitimately does both. Decide before
   authoring, not after.
2. **Per-kind, or one shared budget?** Per-kind is specified above, per the
   original request. One pooled budget is a strictly more interesting choice
   (passives are permanent value, actives are burst) and is the same code with the
   enum removed — worth a playtest before committing.
3. **Does a limit of 0 need to be representable?** `value` is
   `int().positive()`, so a mode cannot author "no attacks at all" except by
   omitting the panel unlock. Probably fine; note it rather than design for it.
4. **Interaction with [36](36-attack-stat-upgrades.md)'s `attack`-less
   `attackStat`** ("+20% to all attacks"): under a cap, a blanket power node
   competes directly with a slot node, which is the intended tension — but it also
   means a wide-tree author can accidentally make slots strictly worse than power.
   A balance question for `/dev.html`, not a code one.

---

## Deferred

- **Design B in full** — see above; nothing here blocks it.
- **Bot support.** `server/src/bot.ts` never buys attack unlocks, so a cap changes
  nothing for it.
- **Simulator support.** `shared/src/simulation/` has no attack handling, so a
  slot-blocked tree walk is invisible to strategy runs — though note that unlike
  plans 36 and 37, this one _does_ reach the simulator, because
  `purchaseBlockReason` is what `simulation/apply.ts` calls. Its `mode` argument
  has to be threaded through even if no simulated strategy ever buys an attack.
- **Authoring on the idler tree** — no base cap and no slot nodes are authored
  here.
