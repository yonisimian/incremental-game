# 29 — Active attacks: prepare cost, preparation time, and "Steal Wood"

## Status: Draft

---

## Goal

Make **active** attacks real. Today they are inert placeholders: an upgrade can
unlock one, it appears in the attack panel, and the panel literally says "Attacks
don't do anything yet."

The v1 mechanic:

1. An upgrade unlocks active attacks (**already exists** — see the inventory
   below).
2. Once unlocked, the player **activates** the attack by paying its
   **prepare cost**.
3. After its **preparation time** elapses, the attack **strikes** — its effect
   lands on the opponent.

Exactly one active attack ships in v1: **Steal Wood** — prepare cost **1000
wood**, preparation time **3 seconds**, steals **10% of the opponent's wood
stockpile**.

Everything else (more attacks, cooldowns, counterplay, bot usage) is deliberately
out of scope; the data model is shaped so those are additive.

One exception is worth flagging before you read further: **simulator support is
owed work, not out of scope forever** — shipping this leaves the balance tooling
blind to the mechanic. See
[⚠️ Reminder: simulator support is still owed](#️-reminder-simulator-support-is-still-owed).

---

## What already exists (verified)

| Piece                     | State                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AttackDefinition`        | `{ id, kind: 'active' \| 'passive', effects? }` in [types.ts](../../shared/src/types.ts) — no cost, no timing.                                                                  |
| Unlock path               | `unlockAttack` effect + `attackGateUpgrades` / `unlockedAttacks`. Idler already has four free upgrade nodes gated behind `a-unlock`, unlocking `a0`–`a3`. **Nothing to build.** |
| Attack flavor             | `AttackFlavorSchema` (`id/name/icon/description`); idler's `a0` is "First Attack" 💥 with an empty description.                                                                 |
| Passive attacks (working) | `enemyProductionModifier` + `collectEnemyDebuffs` → continuous debuff on the opponent's pipeline. Idler `a2` cuts enemy wood production 10%.                                    |
| Victim-side rate display  | `STATE_UPDATE.debuffs` (plan [22](./22-enemy-debuff-own-rate-display.md)) — the victim's header already shows debuffed rates.                                                   |
| Attack panel              | [attack-panel.ts](../../client/src/ui/panels/attack-panel.ts) — read-only cards, every button `disabled`, tab gated by a `panelUnlock`.                                         |
| Editor                    | [views/attacks.ts](../../client/src/dev/editor/views/attacks.ts) authors id / kind / flavor / effects. New fields need rows here.                                               |
| Timing substrate          | `meta.gameSec` accumulates in `applyPassiveTick`; `TICK_INTERVAL_MS = 250`, `BROADCAST_INTERVAL_MS = 500`.                                                                      |

Two things worth naming up front, because they shape the design:

- **Active attacks are a different mechanism from passive ones.** A passive
  attack contributes a _continuous_ modifier to the opponent's pipeline. An active
  attack is an _instantaneous state transfer_ at a scheduled moment. They share
  the unlock path and the panel, and nothing else. `collectEnemyDebuffs` is not
  touched by this plan.
- **The panel's "Attacks don't do anything yet" line is already wrong** (`a2`
  works). Fix it while we're here.

---

## Lifecycle

```text
  locked ──unlockAttack upgrade owned──▶ available
                                            │
                     activate_attack ───────┤ pay prepareCost
                                            ▼
                                        preparing ── readyAtSec = gameSec + prepareTimeSec
                                            │
                        server tick, gameSec >= readyAtSec
                                            ▼
                                          strike ── effect applies to the opponent
                                            │
                                            ▼
                                        available   (no cooldown in v1)
```

The round ending mid-preparation simply discards the pending strike — the cost is
**not** refunded (see Open questions Q3).

---

## Data model

### 1. `AttackDefinition` gains cost + timing

[shared/src/types.ts](../../shared/src/types.ts):

```ts
export interface AttackDefinition {
  readonly id: string
  readonly kind: AttackKind
  /**
   * What activating this attack costs, paid up front at activation. Same shape as
   * upgrade/generator costs, evaluated at level 0 (attacks have no cost curve —
   * each activation costs the same). Required for an `active` attack that carries
   * effects; forbidden on a `passive` one (which is always-on and never activated).
   */
  readonly prepareCost?: Readonly<Record<string, CostEntry>>
  /**
   * Seconds between activation and the strike landing. Measured in *game* seconds
   * (`meta.gameSec`), so it freezes with the round rather than tracking wall clock.
   * `0` strikes on the next tick.
   */
  readonly prepareTimeSec?: number
  readonly effects?: readonly EffectRef[]
}
```

Reusing `CostEntry`/`CostSchema` (rather than a plain `Record<string, number>`)
buys the existing `isCostAffordable` plumbing, the editor's cost widgets, and
multi-currency costs for free. The scaling fields go unused — document that
`scaledCost(entry, 0)` is the evaluation point.

[shared/src/tree/schema.ts](../../shared/src/tree/schema.ts) `AttackSchema` gains
`prepareCost: CostSchema.optional()` and `prepareTimeSec: z.number().min(0).optional()`.
The codec passes attacks through verbatim
([codec.ts](../../shared/src/tree/codec.ts) `attacks: tree.attacks`), so no codec
work is needed.

### 2. New effect: `stealResource`

Following the effects-registry extension model — a new file in
`shared/src/effects/seed/`, registered in
[effects/index.ts](../../shared/src/effects/index.ts):

```ts
const schema = z.strictObject({
  resource: z.string(),
  /** Share of the victim's stockpile taken, e.g. 0.1 = 10%. */
  fraction: z.number().gt(0).max(1),
})
```

emitting a new output kind in
[effects/types.ts](../../shared/src/effects/types.ts):

```ts
/**
 * An instantaneous transfer of a share of the *victim's* stockpile to the
 * attacker, emitted by the `stealResource` effect on an active attack. Unlike
 * `EnemyModifierOutput` (continuous, merged into the opponent's pipeline), this is
 * resolved once, at the moment the attack strikes, by `resolveAttackStrike`.
 */
export interface ResourceStealOutput {
  readonly kind: 'resourceSteal'
  readonly resource: string
  readonly fraction: number
}
```

`apply` is state-independent (echoes the params), matching `unlockAttack` /
`enemyProductionModifier`. Every existing output consumer ignores unknown kinds,
so nothing else changes.

### 3. Idler authoring

[shared/trees/idler.json](../../shared/trees/idler.json) — `a0` becomes the real
attack (`r0` is Wood and is also the score resource):

```json
{
  "id": "a0",
  "kind": "active",
  "prepareCost": { "r0": { "baseCost": 1000 } },
  "prepareTimeSec": 3,
  "effects": [{ "type": "stealResource", "resource": "r0", "fraction": 0.1 }]
}
```

Flavor: `a0` → name **"Steal Wood"**, icon `🪓` (or keep 💥), description
"Steal 10% of your opponent's Wood. Costs 1000 Wood and takes 3 seconds to
prepare." `a1` stays an empty active placeholder and must keep rendering as a
disabled "no effect yet" card — the panel has to tolerate effect-less attacks.

### 4. Editor support

[views/attacks.ts](../../client/src/dev/editor/views/attacks.ts) +
`listAttacks`/`AttackRow`/setters in
[model.ts](../../client/src/dev/editor/model.ts): a prepare-time number input and
a cost editor per attack, shown only for `kind: 'active'`. Without this, the new
fields can only be hand-authored, which CLAUDE.md explicitly discourages.

---

## Runtime state: `PlayerState.pendingAttacks`

```ts
/** An activated attack waiting out its preparation time. */
export interface PendingAttack {
  /** Attack id (matches `AttackDefinition.id`). */
  readonly attack: string
  /** `meta.gameSec` value at which it strikes. */
  readonly readyAtSec: number
}
```

added to `PlayerState` as `pendingAttacks: PendingAttack[]`.

**Why a first-class field and not `meta`.** `meta` is the mode-specific bag
(`highlight`, `gameSec`, `peakCps`) and is `structuredClone`d wholesale. Attack
preparation is engine-level, needs a stable type on both sides of the wire, and
needs to be reasoned about in reconciliation — a typed field earns its keep. The
cost is that every state-shaping site must be updated, and **missing one is a
silent bug**:

| Site                                                                      | What to do                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `createInitialState` ([modes/index.ts](../../shared/src/modes/index.ts))  | `pendingAttacks: []`                                              |
| `EMPTY_PLAYER_STATE` ([client/src/game.ts](../../client/src/game.ts))     | `pendingAttacks: []`                                              |
| `clonePlayerState` (client)                                               | copy the array (**shallow-copy the array**, entries are readonly) |
| `playerWithout` (modes/index.ts, used by `computeRateBreakdown`)          | pass through — it must not affect rates                           |
| `emptyPlayerState` in [unlock-gates.ts](../../shared/src/unlock-gates.ts) | `pendingAttacks: []`                                              |
| `resetForMatch` / round start (client)                                    | cleared with the rest of the state                                |

**Redaction:** `PlayerState` is only ever sent to its owner; the opponent is
projected through `OpponentView`, which is built field-by-field and will simply
not include `pendingAttacks`. So a victim cannot see an incoming strike in
devtools — which is the intended v1 behaviour (Q4).

---

## Timing: game seconds, not wall clock

`readyAtSec = state.meta.gameSec + prepareTimeSec`, and the server strikes when
`gameSec >= readyAtSec`.

`meta.gameSec` advances only inside `applyPassiveTick`, which runs only on a
playing, unpaused tick. That gives three properties for free:

- **Pause-safe.** A paused bot match freezes the tick loop, so preparation
  freezes with it. A wall-clock deadline would keep counting and strike the
  instant the game resumed.
- **Deterministic.** Both players' `gameSec` advance in the same loop, so the
  strike moment is identical for both sides of the transfer.
- **Consistent with existing time-based mechanics** (`relativeModifier` reading
  `meta:peakCps`, `recordPurchase` stamping `meta.gameSec`).

Granularity: ticks are 250 ms, so a 3 s preparation resolves within
`[3.0, 3.25)` game seconds. Broadcasts are 500 ms, so the client can be up to half
a second behind the truth — the panel countdown must therefore be **interpolated
locally** (see Client).

---

## Wire protocol

### Client → server: a new action

[shared/src/types.ts](../../shared/src/types.ts):

```ts
export type ActionType = 'click' | 'buy' | 'buy_generator' | 'set_highlight' | 'activate_attack'
```

plus `attackId?: string` on `PlayerAction` (a new field — `generatorId`/`upgradeId`
set the precedent; do not overload one of those).

### Server → client: strike events

Resources moving with no explanation is exactly the confusion plan
[28](./28-resource-cap.md) is about. Both parties must be told, so
`StateUpdateMessage` gains:

```ts
/**
 * Attack strikes resolved since the previous update (each sent exactly once, to
 * both parties). The attacker sees what it took; the victim sees what it lost.
 * Absent when nothing struck.
 */
attackEvents?: AttackEvent[]
```

```ts
export interface AttackEvent {
  /** Attack id — flavored client-side into a name/icon. */
  attack: string
  /** `'outgoing'` = you struck; `'incoming'` = you were struck. */
  direction: 'outgoing' | 'incoming'
  /** Resource transferred. */
  resource: string
  /** Amount transferred (already applied in this snapshot's state). */
  amount: number
  /** Round-elapsed game seconds when it landed. */
  t: number
}
```

Delivery follows the `purchases` feed precedent: buffered per player, attached to
the next broadcast, cleared once sent — so a strike is never lost between the
250 ms tick and the 500 ms broadcast, and never double-counted.

**Intel leak, accepted:** an `incoming` event tells the victim the opponent has
`a0` unlocked. That is unavoidable if the victim is to understand the loss, and
the loss itself already reveals it. Noted rather than hidden.

---

## Shared helpers (`shared/src/attacks.ts`)

New module, mirroring [purchase-validation.ts](../../shared/src/purchase-validation.ts)'s
"reason or null" pattern so the server's go/no-go and the UI's disabled-state
explanation can't drift:

```ts
/** Why an attack can't be activated right now. `unaffordable` is the only transient one. */
export type AttackBlockReason =
  | 'unknown' // no such attack
  | 'not-active' // passive attacks are always-on, never activated
  | 'locked' // no owned upgrade unlocks it
  | 'no-effects' // placeholder attack with nothing to do
  | 'already-preparing' // one pending instance per attack (v1)
  | 'unaffordable' // can't pay the prepare cost

export function attackBlockReason(state, attackId, mode): AttackBlockReason | null
export function isValidAttackActivation(state, attackId, mode): boolean

/** Prepare cost as a flat currency→amount map (evaluates each `CostEntry` at level 0). */
export function getAttackPrepareCost(def: AttackDefinition): Record<string, number>

/** Pay the cost and queue the strike. Mutates `state`. */
export function applyAttackActivation(state, attackId, mode): void

/** Pending entries whose `readyAtSec <= gameSec`, in queue order. */
export function dueAttacks(state, gameSec): readonly PendingAttack[]

/**
 * Resolve one strike: move `fraction` of the victim's stockpile to the attacker.
 * Mutates both states. Two-player, so only the server calls it — but pure and
 * unit-testable, which is why it lives here rather than in `match.ts`.
 */
export function resolveAttackStrike(
  attacker: PlayerState,
  victim: PlayerState,
  def: AttackDefinition,
  mode: ModeDefinition,
): AttackStrikeResult[] // [{ resource, amount }] — what actually moved
```

Steal arithmetic:

```ts
const held = victim.resources[resource] ?? 0
const amount = Math.max(0, held * fraction)   // 10% of what they hold right now
victim.resources[resource] = Math.max(0, held - amount)
// attacker side goes through plan 28's saturating credit
creditResource(attacker, resource, amount, /* scoreResource */ …)
```

Note the ordering dependency: the victim's balance is read **at strike time**, not
at activation time. Preparing while the opponent is poor and striking after they
bank a purchase is intended play.

---

## The one real design question: does stolen wood count as score?

`r0` is both Wood and the **score resource**, and score is defined as "total score
resource ever _earned_, never decreases". So:

- **Victim:** stockpile drops, `score` is untouched. Not optional — score
  decreasing would break the invariant the whole scoring model rests on.
- **Attacker:** does the stolen wood count as _earned_?

**Recommendation: no.** Credit the attacker's stockpile only, leaving `score`
alone (`creditResource(..., scoreResource: '')`, or a `creditResourceNoScore`
sibling — same clamp, no score mirror). Reasons:

- It matches the refund rule in plan [26](./26-sell-generators.md): moved money is
  not earned money.
- Option B (crediting score) makes every steal a **direct scoreboard swing** with
  no offsetting loss on the victim's side — total score in the match inflates, and
  two players trading steals inflate it together. That's a farm, not a duel.
- Stealing is still strong under Option A: 1000 wood buys you 10% of their bank as
  _spendable_ capital while denying them the same, which compounds through
  generators into score. It's an economy attack, which is what "steal" should be.

Option B is a legitimate design choice — it makes the attack far more decisive and
directly punishes hoarding. It is **the author's call**, and it changes one line
plus the balance section. Everything else in this plan is identical either way, so
it does not block implementation: build Option A, flip if desired.

---

## Server flow

[server/src/match.ts](../../server/src/match.ts):

**Activation** — a new branch in `processActions`, next to `buy_generator`:

```ts
} else if (action.type === 'activate_attack' && action.attackId) {
  if (!isValidAttackActivation(player.state, action.attackId, this.modeDef)) continue
  applyAttackActivation(player.state, action.attackId, this.modeDef)
}
```

No rate limiting needed: `already-preparing` plus the 1000-wood cost bound the
spam. A batch containing 50 activations pays once and rejects 49.

**Resolution** — a new `resolveDueAttacks()` step in the tick loop, ordered
deliberately:

```ts
this.tick++
// … timer / end-of-round check …
for (let i = 0; i < this.players.length; i++) {
  this.applyPassiveIncome(this.players[i], this.players[1 - i]) // 1. income
}
this.resolveDueAttacks() // 2. strikes
if (this.bot) this.processBotActions() // 3. bot
this.checkTargetScoreReached() // 4. win check
```

- **After income**, so a strike lands against the opponent's post-tick balance and
  the transfer is visible in the same snapshot that shows the income.
- **Before `checkTargetScoreReached`**, so under Option B a winning steal ends the
  round on the same tick (under Option A the check is unaffected — worth a comment
  either way).
- Both players are resolved in a fixed player order, and simultaneous mutual
  strikes therefore resolve deterministically: `p1` steals from `p2`'s
  post-income balance, then `p2` steals from `p1`'s post-steal balance. Document
  it; the alternative (snapshot both balances first, then apply) is arguably
  fairer and is Q5.

Each resolution pops the pending entry, calls `resolveAttackStrike`, and buffers
an `outgoing` event for the attacker plus an `incoming` one for the victim.

`endRound` clears pending attacks along with the rest of the round state — no
strike may land after the final score is taken.

---

## Client

### Prediction (`doActivateAttack`)

The **cost** is own-state and predicted immediately; the **outcome** cannot be
predicted at all, because the client doesn't know the opponent's stockpile (and
usually isn't allowed to). So:

```ts
export function doActivateAttack(attackId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!isValidAttackActivation(state.player, attackId, modeDef)) return
  applyAttackActivation(state.player, attackId, modeDef)
  queueAction({ type: 'activate_attack', timestamp: Date.now(), attackId })
  trackPredicted({ kind: 'activate_attack', attackId })
  notify()
}
```

Reconciliation replays it exactly like a purchase: re-validate against the
snapshot, then `applyAttackActivation`. Because `readyAtSec` is derived from the
**snapshot's** `gameSec` with the same formula the server uses, the predicted
countdown converges instead of jittering.

This assumes plan [26](./26-sell-generators.md)'s ordered `PredictedAction[]`
refactor. If plan 26 hasn't landed, this plan needs it (or a fourth parallel
array) — flag the dependency rather than half-doing it.

### Countdown

The panel needs a sub-second countdown between 500 ms broadcasts:
`remaining = readyAtSec - (player.meta.gameSec + secondsSinceLastSnapshot)`,
clamped at 0, re-rendered on the existing UI tick. When it hits 0 the card shows
"striking…" until the snapshot confirms — never a negative number, and never a
card that silently reverts.

### Panel states

`renderSection` grows real buttons; each unlocked **active** attack renders one of:

| State             | Button                                              |
| ----------------- | --------------------------------------------------- |
| affordable        | `Prepare — 🪵1000` (enabled)                        |
| unaffordable      | same, disabled                                      |
| preparing         | `Striking in 2.4s` (disabled, progress-ish styling) |
| no effects (`a1`) | disabled, "no effect yet"                           |

Passive attacks keep their current read-only card. Delete the blanket
"Attacks don't do anything yet." line; if anything, keep a per-card note for
effect-less placeholders.

### Feedback

`attackEvents` drive a toast/VFX: outgoing "Stole 1.2K 🪵", incoming
"Steal Wood — lost 1.2K 🪵". Reuse the existing VFX layer (`ui/vfx/`) rather than
inventing a new surface. Events accumulate into the client state the way
`opponentPurchaseFeed` does, and **must be cleared on round start** — a stale
strike toast in the next match is the classic version of this bug.

### CSS

New states in [style.css](../../client/src/style.css) beside the existing
`.attack-btn` rules: an enabled/affordable look, a disabled/unaffordable look, and
a "preparing" treatment. Keep the bundle budget in mind (warn 60 kB / fail 80 kB).

---

## Boot validation (`validateModeDefinition`)

Mirroring the existing `enemyProductionModifier`-must-be-passive rule, all of
these must **throw at boot** rather than silently no-op:

1. `stealResource` on a non-`active` attack.
2. `stealResource.resource` not in `mode.resources`.
3. An `active` attack **with effects** but no `prepareCost`, or with an empty
   `prepareCost`, or with no `prepareTimeSec`.
4. `prepareCost` naming a currency that isn't a declared resource.
5. `prepareCost` / `prepareTimeSec` declared on a `passive` attack (inert →
   authoring mistake).
6. Negative `prepareTimeSec` (also caught by the schema; validate the assembled
   `ModeDefinition` too, since modes can be built in code).

An `active` attack with **no** effects stays legal — `a1`/`a3` are placeholders.

---

## Interactions with other systems

- **Plan [28](./28-resource-cap.md) (resource cap).** The attacker's credit goes
  through `creditResource` so a steal saturates instead of overflowing. The
  victim's debit is clamped at 0. If plan 28 hasn't landed, use `Math.min` inline
  and leave a TODO pointing at it — do not add a second unclamped `+=`.
- **Plan [26](./26-sell-generators.md) (ordered prediction).** Required for clean
  activation prediction, as above.
- **Espionage.** `accessEnemyData` decides what the attacker can see of the
  victim's wood — which now doubles as targeting intel ("is it worth 1000 wood
  right now?"). No code change; worth knowing that this plan quietly makes
  resource intel more valuable.
- **Simulator / balance gate.** `simulate` is **single-player** — there is no
  opponent to steal from — so `activate_attack` is deliberately **not** a
  `SimAction`, and the envelope gate cannot see this mechanic at all. Consequence:
  `liveActionsToStrategy` silently drops recorded activations (same class of gap
  plan 26 documents), so a round that used attacks won't reproduce as a strategy.
  Modelling PvP in the simulator is its own project — **see the reminder below;
  this is owed work, not a closed decision.**
- **Bot.** `BotAction` is unchanged; bots never activate attacks in v1. A bot match
  is therefore attack-free in one direction — fine for now, but it means the
  mechanic is untested against a live opponent unless two humans play.

---

## Testing

`server`/`client` import compiled shared output — `pnpm --filter @game/shared build`
before their suites.

### Shared — effect + helpers (new `shared/tests/attacks.test.ts`)

- `stealResource` schema: rejects `fraction <= 0`, `> 1`, and unknown extra keys;
  `apply` echoes params as a `resourceSteal` output.
- `getAttackPrepareCost` evaluates `CostEntry`s at level 0 (flat, no scaling).
- `attackBlockReason` returns each of its six reasons in the right situation, and
  `null` when activation is legal; `unaffordable` is the only transient one.
- `applyAttackActivation`: deducts every currency in the cost, pushes exactly one
  pending entry with `readyAtSec === gameSec + prepareTimeSec`, and leaves `score`
  untouched.
- `dueAttacks` is exclusive of not-yet-ready entries and inclusive at exactly
  `readyAtSec`.
- `resolveAttackStrike`: moves exactly `fraction × held`; victim's `score`
  **unchanged**; attacker's `score` unchanged (Option A — this test is the
  executable record of that decision); victim at 0 yields a 0-amount strike that
  still counts as resolved; a victim balance at the plan-28 cap doesn't overflow
  the attacker.
- Round-trip: `activate → strike` leaves the attacker down `1000 - 0.1×victim`
  and the victim down `0.1×victim`, with both `score`s unmoved.

### Shared — validation ([flavor.test.ts](../../shared/tests/flavor.test.ts) / [modes.test.ts](../../shared/tests/modes.test.ts))

One case per boot rule above, each asserting the specific message. Plus: idler
boots (`project.test.ts`) — the regression net for the new `a0` data.

### Server ([server/tests/match.test.ts](../../server/tests/match.test.ts))

- An `activate_attack` action deducts the cost and queues the strike; the strike
  lands on the tick where `gameSec >= readyAtSec` and **not before**.
- The victim's resources drop and the attacker's rise by the same amount in the
  same broadcast.
- Both `attackEvents` are delivered **exactly once** (`outgoing` to the attacker,
  `incoming` to the victim) and are absent from later snapshots.
- `OpponentView` never contains `pendingAttacks` — assert on the serialized
  message, not the object.
- Invalid activations (unknown id, passive attack, locked, unaffordable, already
  preparing) are ignored and don't disturb other actions in the same batch.
- **Pause freezes preparation:** pause for longer than `prepareTimeSec`, unpause,
  and the strike still takes its full 3 game-seconds.
- A round ending mid-preparation resolves nothing, and the cost stays spent.
- Simultaneous mutual strikes resolve deterministically in player order (pins Q5's
  current answer).

### Client

- [game.test.ts](../../client/tests/game.test.ts): `doActivateAttack` pays
  optimistically and queues one action; no-ops when locked / unaffordable /
  already preparing / paused / off-screen. Reconciliation of a batch containing an
  activation converges to the server's `pendingAttacks` (same `readyAtSec`).
- [components.test.ts](../../client/tests/components.test.ts): the panel renders
  the four button states; the countdown never renders negative; an effect-less
  active attack stays disabled; `attackEvents` clear on round start.

Full gate: `pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css`
plus all three suites.

---

## Implementation order

Phased so each step is reviewable and the mechanic only becomes reachable at the
end:

1. **Data + validation.** `AttackDefinition` fields, `AttackSchema`,
   `stealResource` effect + output kind, boot rules, shared tests. Nothing
   observable yet.
2. **State.** `PendingAttack`, `PlayerState.pendingAttacks`, and every
   init/clone/reset site from the table above. Its own commit — a missed site is a
   silent bug and this is the diff you want to bisect to.
3. **Shared helpers.** `shared/src/attacks.ts` (block reasons, activation, due,
   resolution) with its tests. Still unreachable.
4. **Wire + server.** `activate_attack`, `attackEvents`, the `processActions`
   branch, `resolveDueAttacks` in the tick loop, event buffering, `endRound`
   cleanup, server tests. Playable via a hand-crafted action; no UI.
5. **Idler data.** `a0` gains cost/time/effect; flavor becomes "Steal Wood".
6. **Client.** Prediction, countdown, panel states, events/VFX, CSS, tests.
7. **Editor.** Prepare-cost and prepare-time authoring rows for active attacks.

Steps 1–4 are shippable behind "no UI"; step 6 is what turns it on.

---

## Open questions

**Q1 — Does stolen wood credit the attacker's score?** See the section above.
Recommendation: **no** (Option A). Needs the author's call before step 4; a
one-line change either way.

**Q2 — Cooldown?** v1 has none: the 1000-wood cost is the only limiter, so a rich
player can re-prepare the instant a strike lands (effectively a 3-second cycle).
Should attacks carry a `cooldownSec`, or is cost-only pacing right? Cost-only is
simpler and self-balancing (the 10% take shrinks as the victim is drained), which
is why v1 ships without one.

**Q3 — Refund on a strike that never lands?** Round ends (or the opponent quits)
mid-preparation → the 1000 wood is simply gone. Alternative: refund on round end.
Current answer is "no refund, it's a gamble on timing"; cheap to change.

**Q4 — Should the victim see an incoming strike before it lands?** v1: no —
strikes are unannounced, and the victim only learns via the `incoming` event
afterwards. A 3-second telegraph would create real counterplay (spend your wood
before it's taken!), which is arguably the more interesting game, but it needs a
new field on `OpponentView` and UI to match. Deliberately deferred, not rejected.

**Q5 — Simultaneous strike ordering.** v1 resolves in fixed player order, so `p2`
steals from a balance `p1` has already reduced. Snapshotting both balances before
applying either would be symmetric. Fixed order is simpler and the window is one
250 ms tick — but it is a real (small) first-player advantage.

**Q6 — Does an attack need its own unlock cost?** Today the `unlockAttack` upgrade
nodes in idler are **free** (`"cost": {}`), so unlocking is gated only by
`a-unlock` and the tree shape. Now that attacks do something, those nodes probably
want real costs — a data-only change, but it belongs to whoever tunes the tree.

---

## ⚠️ Reminder: simulator support is still owed

**Shipping this plan leaves a known hole: the balance tooling becomes blind to a
mechanic that moves 10% of a player's bank.** This is not a "nice to have" —
record it, and revisit it before active attacks are treated as balanced.

What is blind, concretely:

- **The envelope gate** ([balance/](../../shared/src/balance/)) validates
  strategies against score checkpoints. A strategy that steals, or gets stolen
  from, cannot be expressed, so the gate's verdict is only valid for an
  attack-free match. `analyzeCoverage` can't report attack usage either — there is
  no event kind for it.
- **Mechanic ROI** (`metrics.ts`) can't price an attack at all: no `SimAction`, no
  cost, no contribution. A future "is Steal Wood worth 1000 wood?" question has no
  tooling answer today.
- **Live export** silently drops recorded activations
  ([live-export.ts](../../shared/src/simulation/live-export.ts) maps only the
  action types it knows), so a real round that used attacks re-runs as a _different
  round_ in the simulator, with no warning. If plan
  [26](./26-sell-generators.md)'s live-export work lands first, consider adding a
  loud skip-warning for unmapped action types at the same time — that turns this
  hole from silent into visible, cheaply.

Why it isn't in this plan: `simulate` runs **one** `PlayerState` against a goal.
Attacks need two interacting states, a strike schedule, and a decision about what
the _opponent_ does — which is a second engine (or a two-run co-simulation), not a
new action kind. Rough shape when it's picked up:

1. A two-player sim loop: two states, two cursors, one shared clock.
2. `activate_attack` as a `SimAction` (schema, `canonicalAction`,
   `validateStrategyForMode`, `applySimAction`, `simulate`'s cursor) — the same
   consumer sweep plan [26](./26-sell-generators.md) documents for
   `sell_generator`, plus the exhaustive switches `pnpm typecheck` will name.
3. An opponent policy for single-strategy runs (mirror-match, or a scripted
   punching bag) so existing one-sided strategies keep working unchanged.
4. `SimEvent` coverage for strikes, so `analyzeCoverage` and the charts can see
   them.

Until that exists, treat every envelope/ROI number as "assuming no attacks", and
say so when quoting one.

---

## Deferred

- **More active attacks** (slow their production for N seconds, steal a
  generator's output, block clicking). The data model takes them as new effects;
  no engine change expected.
- **Attack targeting UI** for >2 players — not applicable while matches are 1v1.
- **Bot attack usage**, which needs a heuristic for "is stealing worth it now" and
  is really a bot-strategy project. Note it is also the cheapest way to exercise
  attacks in a repeatable way before full PvP simulation exists.
- **PvP simulation** — see the reminder above.
- **Defensive mechanics** (pacts already exist as inert placeholders — a shield
  pact is the obvious counterpart, and `PactDefinition` would need the same
  treatment this plan gives attacks).
