# 49 — Pact limit: slots for active and passive pacts

## Status: Implemented

As built. One addition to §7: the bot's plan signed every live passive pact.
Past the budget a sign is refused by the slot gate; the plan advances on
emitting a buy, so a refused sign does not stall it, but the emit is wasted.
The bot now plans mutual pacts first and judges every step by
`purchaseBlockReason` before emitting it: a step an earlier buy has made a
dead end (a full slot budget, a closed choice group) is skipped in place, so
the budget needs no bookkeeping of its own in the bot.

The pact twin of [38 — attack limit](38-attack-limit.md). Builds on
[48 — active pacts](48-active-pacts.md) (both kinds now do something, so
holding one is a real commitment).

---

## Goal

Cap how many pacts of each kind a player may **hold** (unlock), exactly as
`attackSlots` caps attacks: a budget per kind, granted by the mode and raised
by upgrades, enforced by refusing the **purchase** that would unlock one too
many. Unlocking stays derived and monotonic; no player state is added.

---

## Decisions

| Question                         | Decision                                                                       | Why                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| One effect for both, or a twin?  | A twin: **`pactSlots`** `{ pactKind: 'active' \| 'passive', value: int > 0 }`. | `attackSlots` names `attackKind`; widening it to pacts would change its params and data. |
| Budget per kind or pooled?       | Per kind, like attacks.                                                        | Same reasoning as plan 38: permanent value and burst value are priced separately.        |
| Opt-in?                          | Yes — a kind no `pactSlots` names is uncapped (`Infinity`).                    | Modes without pact slots keep working untouched.                                         |
| What counts as held?             | Unlocked pacts of the kind (`unlockedPacts`), however many routes unlock them. | As `attackSlotsHeld`.                                                                    |
| Purchase gate                    | New `PurchaseBlockReason` **`'pact-slots'`**, beside `'attack-slots'`.         | Distinct reason, so the UI can say which budget is full.                                 |
| An upgrade that unlocks and adds | Legal: the limit checked includes the slots the upgrade itself grants.         | As `hasAttackSlotsFor`.                                                                  |
| Shared code                      | Parallel functions in `pacts.ts`, not a generic "slots" abstraction.           | Two call sites; plan 50 (weights) touches both and can extract a helper if it pays.      |

---

## Approach

### 1. Effect — `pactSlots`

`shared/src/effects/seed/pact-slots.ts`, the `attackSlots` seed with
`pactKind`. Output `{ kind: 'pactSlots', pactKind, value }`. Default hosts
(mode + upgrade). Registered in `effects/index.ts`.

### 2. Rules — `pacts.ts`

Mirroring [attacks.ts § Attack slots](../../shared/src/attacks.ts):

```ts
export function isPactKindCapped(mode, kind): boolean // cached per mode (WeakMap)
export function pactLimit(state, mode, kind): number // base + Σ value × owned; Infinity if uncapped
export function pactSlotsHeld(state, mode, kind): number
export function hasPactSlotsFor(state, def: UpgradeDefinition, mode): boolean
```

### 3. Purchase gate

`purchaseBlockReason` ([purchase-validation.ts](../../shared/src/purchase-validation.ts)):
`if (!hasPactSlotsFor(state, def, mode)) return 'pact-slots'` right after the
attack-slot check. Server, bot and client prediction all go through it.

### 4. Boot validation

Beside the attack-slot rule in `validateModeDefinition`: a mode whose starting
effects unlock more pacts of a capped kind than its base `pactSlots` grant
throws (the round would open over budget).

### 5. Client

- Relations panel: `Active 1 / 1`, `Passive 2 / 3` in the section headings, as
  the attack panel's `renderSlots`.
- Upgrade detail: `'pact-slots'` → "No pact slots left"; `components.ts` maps
  it to the locked style.

### 6. Editor

`pactSlots` joins the "Pacts" effect group.

### 7. Content (placeholder numbers)

Idler (both trees), mode `startingEffects`: `pactSlots passive 2`. With four
passive pacts, that makes the relations branch a choice. Active pacts stay
uncapped: with one active pact a cap of 1 could never bind and would only add
an `Active 1 / 1` badge. Cap them once a second active pact exists. No slot
upgrades yet.

---

## Tests

- `pacts.test.ts` — uncapped → `Infinity`; base + owned grants; held counts
  pacts not routes; `hasPactSlotsFor` refuses one too many, allows a second
  route to a held pact, allows unlock-and-grant in one purchase, is per kind.
- `purchase-validation` / `pacts.test.ts` — `purchaseBlockReason` returns
  `'pact-slots'`, after the structural reasons and before `unaffordable`.
- `effects.test.ts` — schema (positive int, kind enum).
- `flavor.test.ts` — starting unlocks over the base throw.
- Server — a buy that would exceed the limit is refused.
- Client — relations headings show `held / limit`; upgrade detail label.

---

## Implementation order

1. `docs(plans): 49 — pact limit`
2. `feat(pacts): pact slots` — §1–§6 with tests.
3. `feat(idler): pact slot budgets` — §7.

---

## Open questions

1. **Budget numbers** — passive 2 is a placeholder for balance; active is
   uncapped until a second active pact exists.
2. **Slot upgrades** — none authored; the attack tree has `slot-*` nodes, the
   relations branch could get the same once the numbers settle.
