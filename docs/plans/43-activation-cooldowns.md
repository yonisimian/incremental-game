# 43 — Activation cooldowns: a rest after the effect ends

## Status: Design (not scheduled)

Second of the three pact plans. Shared machinery for
[42 — passive pacts](42-passive-pacts.md) (which needs none of it) and
[44 — active pacts](44-active-pacts.md) (which needs all of it). The **attack
half is implementable on its own today**; the pact half lands with 44.

---

## Goal

An active attack can be re-activated the tick its debuff window closes (or, for
a steal-only attack, the tick it lands). The only brake is the prepare cost. An
active pact (plan 44) will have the same shape — activate, enjoy a window — and
the same problem: with a cheap activation cost the "active" kind degenerates
into a passive one with a click tax.

Add **`cooldownSec`** to both definitions: after the effect ends, the attack or
pact cannot be activated again until the cooldown has elapsed, in game seconds.
The card shows a countdown and the block reason says why.

---

## What already exists (verified)

- **Two block reasons already describe "not yet".** `AttackBlockReason`
  ([attacks.ts](../../shared/src/attacks.ts#L311)) has `already-preparing`
  (in `pendingAttacks`) and `already-active` (an open window in
  `activeDebuffs`, judged by `activeDebuffRemainingSec`). Nothing describes
  "the window closed a moment ago".
- **Windows are swept.** `resolveDueAttacks`
  ([match.ts](../../server/src/match.ts#L576)) drops expired `activeDebuffs`
  at the top of each tick; collectors judge expiry at read time so the sweep
  is hygiene. Once swept, nothing remembers the window ever existed — so a
  cooldown cannot be derived from the window record.
- **Steal-only attacks open no window at all.** `resolveAttackStrike`
  ([attacks.ts](../../shared/src/attacks.ts#L508)) opens a window only for
  debuff outputs; a pure `stealResource` attack leaves no trace on the
  attacker's state after the strike.
- **Timing is frozen at activation** (`readyAtSec`) and at the strike
  (window length via `getAttackDurationSec`, plan 37 as built). A cooldown is
  stamped the same way — at the strike, when the window length is known.
- **Attack stats have a direction table.** `ATTACK_STATS`
  ([attack-stat.ts](../../shared/src/effects/seed/attack-stat.ts#L13)) is
  `power | prepareCost | prepareTime | duration`, each with a direction and an
  `offset` rule. A `cooldown` stat is one more row.
- **The panel already counts down** `pendingRemaining` and the window's
  remaining seconds on the card
  ([attack-panel.ts](../../client/src/ui/panels/attack-panel.ts)).
- **The client never predicts a strike.** `activeDebuffs` is "never predicted,
  only carried" through `clonePlayerState`
  ([game.ts](../../client/src/game.ts#L994)). A cooldown record is the same.

---

## Approach

### 1. `cooldownSec` on both definitions

```ts
// AttackDefinition
/**
 * Seconds after this attack's effect *ends* before it can be activated again,
 * in game seconds. The effect ends when its debuff window closes, or at the
 * strike for an attack with no window. Active attacks only; optional (no
 * cooldown = re-activatable at once, today's behavior).
 */
readonly cooldownSec?: number

// PactDefinition (plan 44 adds the rest of the active fields)
readonly cooldownSec?: number
```

`AttackSchema` / `PactSchema`: `cooldownSec: z.number().positive().optional()`.

### 2. One state field: `PlayerState.cooldowns`

```ts
/** What is cooling down. `kind` keeps attack and pact ids in separate namespaces. */
export interface Cooldown {
  readonly kind: 'attack' | 'pact'
  readonly id: string
  /** The owner's `meta.gameSec` at which the cooldown lifts. */
  readonly untilSec: number
}

// PlayerState
/**
 * Activations resting after their effect ended (plan 43). Server-stamped when
 * the effect's end time is known, swept once elapsed, judged at read time by
 * `cooldownRemainingSec` so the sweep is hygiene. Absent when empty. Never
 * predicted, only carried, like `activeDebuffs`.
 */
cooldowns?: Cooldown[]
```

One field rather than `attackCooldowns` + `pactCooldowns`: the record shape,
the sweep, the read-time test and the client carry are identical, and the
`kind` discriminant keeps the ids apart. The cost is one filter per read,
which the read-time helper hides.

A new `shared/src/cooldowns.ts`:

```ts
export function cooldownRemainingSec(state, kind, id): number | null // null = not cooling
export function startCooldown(state, kind, id, untilSec): void // replaces an existing entry for the same (kind, id)
export function sweepCooldowns(state, gameSec): void // drops elapsed, deletes the field when empty
```

### 3. Stamping — at the strike, not at the window close

In `resolveDueAttacks`, right after a strike is resolved:

```ts
if (def.cooldownSec !== undefined) {
  const endsAt = window ? window.expiresAtSec : gameSec // window = the ActiveDebuff just opened, if any
  startCooldown(attacker.state, 'attack', def.id, endsAt + getAttackCooldownSec(def, params))
}
```

Stamping when the strike lands (with the window length in hand) means no
"window closed" event is needed and the sweep stays hygiene. A miss
(`moved.length === 0`, no window) still starts the cooldown: the activation was
paid for and resolved. The sweep runs beside the window sweep at the top of
the function.

For pacts, plan 44's activation opens the window immediately, so the cooldown
is stamped **at activation** as `gameSec + durationSec + cooldownSec` — and, as
the one predicted case, the client stamps it too (it predicts the activation
already), so the card's countdown does not wait for the snapshot.

### 4. Block reason and validation

```ts
export type AttackBlockReason =
  | …
  | 'already-active'
  | 'cooling-down' // the effect ended; cooldownSec has not elapsed
  | 'unaffordable'
```

Checked after `already-active` and before `unaffordable` in
`attackBlockReason` — permanent-for-this-state reasons before the transient
one, as the existing order does. `isValidAttackActivation` picks it up for
free; so do the server and the bot.

Boot rules, beside the `durationSec` ones:

- `cooldownSec` on a passive attack/pact → throw ("always-on, never
  activated").
- `cooldownSec <= 0` on a programmatically built mode → throw (schema covers
  the file path).

### 5. A `cooldown` attack stat

`ATTACK_STATS` gains `'cooldown'`: active-only, `reduce` direction, `offset`
allowed (seconds — same unit class as `duration` / `prepareTime`), floored at
`0` by `getAttackCooldownSec(def, params)`, the twin of
`getAttackDurationSec`. Read **at the strike**, frozen into `untilSec` — a
cooldown upgrade bought mid-rest does not shorten the rest in progress, for the
same reason a prepare-time upgrade does not pull a pending strike forward.

A `cooldown` stat aimed at an attack with no `cooldownSec` is rejected at boot,
like `duration` on a window-less attack (plan 37 as built).

### 6. Client

- `clonePlayerState` carries `cooldowns` (never predicted for attacks).
- **Attack card:** a fourth state after preparing / active — `⏳ ready in 12s`,
  disabled, from `cooldownRemainingSec(player, 'attack', id)` against
  `meta.gameSec`. Steps at snapshot cadence like the other card countdowns (the
  header badge is the only interpolated one, and it is a warning, not a
  button).
- **Stat preview** in the card's stats block lists the cooldown beside
  duration.
- **Toast:** none. The card is the surface; a "ready again" toast would fire
  for every attack every time and drown the strike toasts.

### 7. Editor

The attack row gains a "Cooldown /s" input beside "Debuff duration /s",
cleared on a switch to passive with the rest of the timing data. The `cooldown`
stat appears in the stat preview's resolution. The pact row gets the same input
in plan 44.

### 8. Bot

`attackBlockReason` already gates `fireAttack`; `'cooling-down'` is skipped
like every non-null reason. No change.

---

## Tests (sketch)

- `cooldowns.test.ts`: start / replace / remaining / sweep; the field is
  deleted when empty; `null` for an id not cooling; attack and pact ids do not
  collide.
- `attacks.test.ts`: `attackBlockReason` returns `cooling-down` inside the
  rest and `null` after; ordering against `already-active` and
  `unaffordable`; `getAttackCooldownSec` floors at 0 and honors `offset`.
- `match.test.ts`: a strike with a window stamps `untilSec = expiresAt +
cooldown`; a steal-only strike stamps `gameSec + cooldown`; a miss still
  stamps; a second activation during the rest is rejected and after it
  accepted; the record survives a pause (game seconds) and is swept once
  elapsed; the stamp is frozen against a mid-rest cooldown upgrade.
- Client: card shows the countdown and disables; clone carries the field.
- Validation: passive + `cooldownSec` throws; stat without a target
  `cooldownSec` throws.

## Implementation order (attack half)

1. `feat(attacks): cooldowns module and PlayerState.cooldowns` — §2, tests.
2. `feat(attacks): cooldownSec on attacks — stamp at strike, cooling-down block reason` — §1, §3, §4, boot rules, server tests.
3. `feat(attacks): cooldown attack stat` — §5.
4. `feat(client): attack card cooldown state` — §6.
5. `feat(editor): cooldown field` — §7.
6. `balance(idler): cooldowns on the strong active attacks` — data; the long
   windows (`termite-swarm` 67s, `numb-hands` 15s) are the obvious first
   candidates.

---

## Open questions

1. **Does the cooldown start at the window close or at the strike?** The ask
   was "after it finishes the effect", so at the close; a steal has no
   duration so its close _is_ the strike. Alternative: always from the strike,
   which makes `cooldownSec` read as a fixed rhythm regardless of window
   length. _Proposed: from the close, as asked._
2. **Should `already-active` and `cooling-down` collapse into one "busy" state
   on the card?** Two states read better (the player learns the rhythm), and
   the reasons are one enum member apart.
3. **Global cooldown across all attacks** (one strike, then a rest for every
   attack)? A different mechanic — a `kind`-level cooldown would live beside
   `attackSlots` as a per-kind grant. Out of scope; noted so it is not shoehorned
   into this field.
