# 44 — Active pacts: sign a treaty, enjoy a window, rest

## Status: Design (not scheduled)

Third of the three pact plans. Depends on
[42 — passive pacts](42-passive-pacts.md) (the resolver module, hosts, wire
fields and panel) and [43 — cooldowns](43-activation-cooldowns.md) (the rest
after the window). This document says how to build it; it does not build it.

---

## Goal

`p0` / `p1` are the two `active` pacts in the idler tree. An active pact is a
treaty you **sign** for a price: it opens a timed window during which its
effects apply to you (and, if `mutual`, to the enemy), then closes, then rests
(plan 43). Same vocabulary as a passive pact — the mirror effects from plan 42
— plus a third effect that only makes sense timed: a flat shared buff, the
"ceasefire" that lifts both economies for fifteen seconds.

The lifecycle is deliberately the active-attack lifecycle with the strike
removed: **activate → window → cooldown**. No preparation delay (an ally signs
at once), and the window opens on the activating player, so the client can
predict it the way it predicts an attack activation.

---

## Lifecycle

```text
locked ──unlockPact──▶ ready ──activate_pact (pay)──▶ active (durationSec) ──▶ cooling (cooldownSec) ──▶ ready
```

- **ready**: unlocked, no open window, no cooldown, affordable → the card is a
  button showing the activation cost.
- **active**: `activePacts` holds `{ pact, expiresAtSec }`; effects resolve
  for the owner (and the partner if mutual); the card counts down.
- **cooling**: `cooldowns` holds `{ kind: 'pact', id, untilSec }`; the card
  counts down in a different tone.

---

## Data model

### `PactDefinition` (completing plan 42's shape)

```ts
export interface PactDefinition {
  readonly id: string
  readonly kind: PactKind
  readonly mutual?: boolean
  readonly effects?: readonly EffectRef[]
  /** Paid at activation, evaluated at level 0 like `prepareCost`. Required for an active pact with effects; forbidden on a passive one. */
  readonly activationCost?: Readonly<Record<string, CostEntry>>
  /** Game seconds the window stays open. Required for an active pact with effects; forbidden on a passive one. */
  readonly durationSec?: number
  /** Plan 43. Active only, optional. */
  readonly cooldownSec?: number
}
```

No `prepareTimeSec`. If a delay is ever wanted ("the envoy travels"), it is
`pendingPacts` mirroring `pendingAttacks`; not designed here because it adds a
second timer state for no gameplay the cooldown does not already provide.

### `PlayerState.activePacts`

```ts
export interface ActivePact {
  readonly pact: string
  /** The owner's `meta.gameSec` at which the window closes. */
  readonly expiresAtSec: number
}
activePacts?: ActivePact[]
```

The twin of `activeDebuffs`, with one difference: it **is predicted**, because
the activation is the opening (no strike in between). The client pushes the
window in `doActivatePact` exactly as `applyAttackActivation` pushes a pending
attack, and the reconcile replays it.

### Action

```ts
// shared/src/types.ts — PlayerAction
| { type: 'activate_pact'; pactId: string }
```

`BotAction` gains the same member.

---

## Shared helpers (`shared/src/pacts.ts`, extending plan 42)

```ts
export type PactBlockReason =
  | 'unknown'
  | 'not-active'
  | 'locked'
  | 'no-effects'
  | 'already-active'
  | 'cooling-down'
  | 'unaffordable'

export function pactBlockReason(state, pactId, mode): PactBlockReason | null
export function isValidPactActivation(state, pactId, mode): boolean
export function getPactActivationCost(def): Record<string, number> // scaledCost(entry, 0); no stat scaling in v1
export function applyPactActivation(state, pactId, mode): void // deduct, push window, start cooldown (plan 43 §3)
export function activePactRemainingSec(state, pactId): number | null
export function openPactWindows(state, gameSec): ActivePact[]
```

`pactsInForce(owner, partner, mode)` grows its third and fourth passes: the
owner's open active windows, then the partner's open **mutual** active windows.
Everything downstream — `collectPactCostFactors`, `collectPactBonuses`, the
stamping, the wire, the panel — is unchanged: a window is just a pact that is
in force for a while.

---

## The third effect: `pactProductionModifier` → output `pactModifier`

```ts
const schema = z
  .strictObject({ stage: z.enum(MODIFIER_STAGES), field: z.string(), value: z.number() })
  .superRefine(guardModifierValue('bonus', 'pactProductionModifier'))
```

`hosts: ['passivePact', 'activePact']`. A flat buff to the owner's `field`
(enemy-debuff target catalog, `highlightFactor` multiplicative-only), and to
the partner's when `mutual`. On a passive pact it is a permanent "+5% for both";
on an active one it is the ceasefire. The resolver treats it as a
`mirrorModifier` with a constant: `collectPactBonuses` pushes it verbatim.

Why it is here and not in plan 42: a permanent mutual flat buff is a strange
pact (why sign it? both gain equally), while a **timed** one is a decision
("we both need to build for fifteen seconds — do I sign while they are
saving?"). It also gives `p0`/`p1` something the mirror effects do not:
independence from the enemy's stats.

---

## Consent

A pact is a two-party word; the mechanic is unilateral. Three options:

1. **Unilateral** — the owner signs, the partner is affected (if mutual) with
   no say. Simplest; matches attacks; the cost of a mutual pact is that the
   enemy profits too. _Recommended for v1._
2. **Veto** — the partner may cancel an incoming mutual window within N seconds
   (a `decline_pact` action; the window closes early for both, the owner is
   refunded or not). Adds a message, a timer state, a bot policy, and a UI
   prompt the partner must notice mid-click. A lot of surface for a rarely
   exercised right.
3. **Handshake** — propose / accept with a timeout. Everything in 2 plus a
   pending state on both sides and a bot acceptance heuristic. The realistic
   diplomacy model, and the wrong first step: nothing in the game is
   asynchronous-between-players yet.

Go with 1. Design the panel copy so a mutual active pact reads as an offer the
enemy cannot refuse ("Both sides produce +25% for 15s") rather than something
they agreed to. If 2 or 3 is ever wanted, it is a new pact `consent` field and
plan on its own.

---

## Server

- `processActions` / `processBotActions`: the `activate_pact` branch →
  `isValidPactActivation` → `applyPactActivation` (one line each, beside the
  attack branch).
- Tick: `pactsInForce` already reads windows; the per-tick snapshot from plan
  42 §8 picks them up with no change. Sweep expired `activePacts` and pact
  cooldowns at the top of the tick, beside the attack window sweep.
- `endRound` clears `activePacts` with `pendingAttacks` / `activeDebuffs`.
- **Events:** `PactEvent { pact, direction: 'own' | 'partner', t, durationSec }`
  buffered on `MatchPlayer.pactEvents` and drained on the broadcast like
  `attackEvents`. Emitted at activation (own) and, for a mutual pact, to the
  partner. Plan 31's reserved pact toasts finally have a trigger.
- `OpponentView.pacts` (plan 42) becomes
  `{ pact: string; expiresAtSec?: number }[]` so the partner's card can count
  down a mutual window it did not sign.

---

## Client

- `doActivatePact(pactId)`: optimistic `applyPactActivation` +
  `queueAction({ type: 'activate_pact', pactId })` + `trackPredicted`, mirrored
  in the reconcile replay — the attack code path with the name changed.
- `clonePlayerState` carries `activePacts` (predicted, so it must be cloned
  deeply enough to be replayed) and `cooldowns`.
- **Relations panel, active section:** each card is a button with the cost
  (`isCostAffordable` styling as the attack card), or a countdown while active
  (`activePactRemainingSec`), or a cooldown countdown (plan 43 §6), or the
  block reason. Worth lines from `pactBonuses` while the window is open.
  "Shared treaties" shows partner-signed mutual windows with their countdown.
- **Toasts:** own `🤝 Ceasefire signed — +25% for 15s`; partner
  `🤝 Enemy signed Ceasefire — you both produce +25% for 15s`. Reuse the
  `success` / `info` variants; no shake.
- **Hotkey:** none in v1; the panel is the surface.

---

## Validation, editor, bot

- **Boot:** active pact with effects → `activationCost` and `durationSec`
  required; passive pact with any of the three timing/cost fields → throw
  (moves from schema to boot rule now that the fields exist);
  `pactProductionModifier` field/stage rules as for `enemyProductionModifier`;
  `activationCost` currencies must exist.
- **Editor:** the pact row (plan 42 §11) gains cost, duration and cooldown
  inputs behind the kind select, cleared on a switch to passive, as the attack
  row does; `pactProductionModifier` joins the "Pacts" picker group.
- **Bot:** `firePact` beside `fireAttack` — after the plan is exhausted, for
  each unlocked active pact with `pactBlockReason === null` and an affordable
  cost, one activation per tick. Mutual pacts are fired without hesitation in
  v1 (the bot does not model the opponent); a later heuristic could hold a
  mutual pact until the bot is ahead.

---

## Idler authoring (sketch)

| Pact | Change                                                                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p0` | "🕊️ Ceasefire" — `mutual: true`, `activationCost: { r0: 50 }`, `durationSec: 15`, `cooldownSec: 30`, `effects: [{ type: 'pactProductionModifier', field: 'r0', stage: 'multiplicative', value: 1.25 }]`                     |
| `p1` | "🍺 Trade fair" — one-sided, `activationCost: { r1: 20 }`, `durationSec: 20`, `cooldownSec: 40`, `effects: [{ type: 'mirrorStatModifier', source: 'r1:rate', field: 'r0', stage: 'multiplicative', perUnit: 0.1, cap: 1 }]` |

Numbers are placeholders for the balance pass; `pact-node` / `pact-node-2`
keep `cost: {}`.

---

## Tests (sketch)

- `pacts.test.ts`: block reasons in order; activation deducts, opens the
  window, stamps the cooldown; `pactsInForce` includes own windows and partner
  mutual windows, excludes expired and one-sided ones; `pactProductionModifier`
  resolves verbatim.
- `match.test.ts`: `activate_pact` validated and applied; a mutual window
  credits both; events emitted to the right sides; the partner's view carries
  the window with expiry; a one-sided window never reaches the partner; sweep
  and `endRound` clear state.
- Client: prediction + replay; panel states; toasts once per event.
- Bot: fires when ready and affordable, skips while cooling.

---

## Implementation order (sketch)

1. Plan 43 attack half (so `cooldowns` exists).
2. `feat(pacts): active fields on PactDefinition, activePacts, pactBlockReason, applyPactActivation` + boot rules.
3. `feat(pacts): windows in pactsInForce` — income moves for an activated pact;
   re-add `activePact` to both pact effects' `hosts` in the same commit (it was
   removed so an active pact with effects fails at boot while nothing reads it).
4. `feat(net): activate_pact action, PactEvent, expiry on opponent pacts`.
5. `feat(pacts): pactProductionModifier`.
6. `feat(client): activate from the relations panel, prediction, toasts`.
7. `feat(editor): active pact fields`.
8. `feat(idler): author Ceasefire and Trade fair`.
9. `feat(bot): sign active pacts from surplus`.

---

## Open questions

1. **Consent model** — unilateral as recommended, or veto? Decides whether a
   new client → server message exists.
2. **Should a mutual active pact be refundable / cancellable by the owner?**
   Attacks are not; proposed no.
3. **Pact slots**, the `attackSlots` twin — cap how many pacts a player may
   hold? Cheap to add (same collector shape); no current need.
4. **Stat upgrades for pacts** (`pactStat`: cost, duration, cooldown) — the
   `attackStat` machinery generalizes, but wait for a tree branch that wants
   it.
