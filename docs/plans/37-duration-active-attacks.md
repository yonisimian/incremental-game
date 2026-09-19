# 37 — Duration active attacks: a debuff window instead of a one-shot theft

## Status: Implemented (branch `feat/6-duration-active-attacks`)

Second of the three attack-extension plans (36 → 37 → 38). Independent of
[36 — attack stat upgrades](36-attack-stat-upgrades.md) mechanically, but the two
are designed to meet: a window whose length is upgradeable is the balancing
lever this plan needs.

### As built — departures from the text below

- **The `duration` attack stat landed here, not in 36.** Plan 36 shipped
  without it (it had no consumer). It is now in `ATTACK_STATS`, active-only,
  `increase`-direction, `offset`-capable (seconds), floored at `0`, and consumed
  by `getAttackDurationSec` when the strike opens the window — the twin of
  `getAttackPrepareTimeSec`. `AttackParams` grew `duration` and
  `durationOffsetSec`. A `duration` stat aimed at an attack with no
  `durationSec` is rejected at boot, like `prepareTime` on a delay-less attack.
- **Power is read live, not frozen.** Plan 36 made both collectors scale a
  passive attack's values by the attacker's current `power`; the window pass does
  the same, so a window and a passive attack are scaled identically. Only the
  window's _length_ is frozen at the strike.
- **One shared walk.** Both collectors iterate `attacksInForce(attacker, mode)`
  — unlocked passive attacks, then open windows — rather than each carrying its
  own second pass, so "what is in force" cannot diverge between production and
  prices.
- **The editor needed a field after all.** The effect picker followed the host
  declaration for free, but the attack row hard-codes its fields, so `/dev.html`
  gained a "Debuff duration /s" input (`setAttackDuration`), cleared on a switch
  to passive alongside the prepare data, and the stat preview resolves
  `duration` against it.
- **Sweep placement.** The expiry sweep runs at the top of `resolveDueAttacks`,
  before that tick's strikes land, and drops the field entirely (absent, not
  empty) when the last window closes. `endRound` clears it with `pendingAttacks`.
- **Toast copy.** Outgoing "`⚔️ Name: enemy debuffed for 12s`", incoming
  "`⚔️ Name: debuffed for 12s`" with the medium shake.

Open question 1 (victim-side countdown) shipped as proposed: without it. Open
question 2 is now a test (a window survives a pause). Deferred items stand.

---

## Goal

An active attack resolves **once**: pay, wait out the preparation, take something.
A passive attack applies **forever**: unlock it and the opponent is permanently
10% slower. There is nothing in between — and "in between" is where the strong
numbers live, because a debuff that lasts 12 seconds can be brutal in a way a
permanent one never can.

Add **duration to active attacks**: the strike opens a timed window during which
the attack's `enemyProductionModifier` / `enemyCostModifier` effects apply to the
victim, then it closes. Same authoring vocabulary as a passive attack, an order of
magnitude stronger values, paid for with a prepare cost and a preparation delay.

Ship the **mechanic + validation + editor + panel countdown + tests**; author
nothing on [idler.json](../../shared/trees/idler.json).

---

## What already exists (verified)

- **Offensive collection is attacker-keyed and already runs every tick.**
  [`collectEnemyDebuffs(attacker, mode)`](../../shared/src/modes/index.ts#L1094)
  and
  [`collectEnemyCostFactors(attacker, mode)`](../../shared/src/modes/index.ts#L1125)
  both walk `unlockedAttacks(attacker, mode)`, keep only `passive` ones, and
  gather `enemyModifier` / `enemyCost` outputs. Their consumers are all in place:
  passive income merges them per player
  ([match.ts:526-529](../../server/src/match.ts#L526-L529)), click income does the
  same ([match.ts:636-642](../../server/src/match.ts#L636-L642)), the broadcast
  ships them unresolved
  ([match.ts:719-720](../../server/src/match.ts#L719-L720)), and cost factors are
  stamped onto the victim by
  [`syncCostFactors`](../../server/src/match.ts#L427) before every action batch,
  before the bot's actions, and before every broadcast.
- **The client already renders incoming debuffs.**
  [`resolveEnemyDebuffs`](../../shared/src/modes/index.ts#L1177) is applied
  client-side to `state.debuffs` in the data panel
  ([data-panel.ts:483-487](../../client/src/ui/panels/data-panel.ts#L483-L487)),
  in the click-income prediction
  ([game.ts:882-895](../../client/src/game.ts#L882-L895)), and in the
  click/highlight debuff rows
  ([data-panel.ts:344-350](../../client/src/ui/panels/data-panel.ts#L344-L350),
  [:431-433](../../client/src/ui/panels/data-panel.ts#L431-L433)). None of it
  cares _why_ a debuff is present.
- **`pendingAttacks` is the precedent for a timed, engine-level state field.**
  [types.ts:171-172](../../shared/src/types.ts#L171-L172) plus the test its
  sibling's doc states
  ([types.ts:173-188](../../shared/src/types.ts#L173-L188)): a field belongs on
  `PlayerState` rather than in `meta` when it is "engine-level, wire-stable, and
  reasoned about during reconciliation." The whole lifecycle is already modelled
  once — [`dueAttacks`](../../shared/src/attacks.ts#L102) filters by
  `readyAtSec <= gameSec`, and
  [match.ts:600](../../server/src/match.ts#L600) drains the resolved entries with
  an identity filter.
- **Timing is in game seconds.** `applyAttackActivation`
  ([attacks.ts:94-95](../../shared/src/attacks.ts#L94-L95)) reads
  `state.meta.gameSec` itself and stamps `readyAtSec` from it, so nothing in the
  attack path needs a clock argument. `meta.gameSec` advances in
  `applyPassiveTick`, which runs before
  [`resolveDueAttacks`](../../server/src/match.ts#L546) in the tick
  ([match.ts:363-371](../../server/src/match.ts#L363-L371)).
- **Host declaration is the only thing keeping these effects off active attacks.**
  `enemyProductionModifier` declares `hosts: ['passiveAttack']`
  ([seed/enemy-production-modifier.ts](../../shared/src/effects/seed/enemy-production-modifier.ts)),
  as does `enemyCostModifier`; the boot-time `checkHost` loop
  ([modes/index.ts:311-329](../../shared/src/modes/index.ts#L311-L329)) enforces
  it and the editor's picker follows the same declaration.
- **Debuff values are already permitted to be strong.**
  [`guardModifierValue`](../../shared/src/modifiers/value-guard.ts) accepts any
  multiplicative debuff in `(0, 1)` and any negative additive one, so `0.3` for a
  15-second window needs **no** schema change.
- **The strike event union is closed and small.** `AttackEvent`
  ([messages.ts:120-158](../../shared/src/messages.ts#L120-L158)) is
  `resource | generator | none`, rendered as toasts by `showAttackEvents`
  ([game.ts:846](../../client/src/game.ts#L846)).
- **Blocked activations already have a reason vocabulary.**
  `AttackBlockReason` ([attacks.ts:23-30](../../shared/src/attacks.ts#L23-L30))
  and `blockLabel` ([attack-panel.ts:52](../../client/src/ui/panels/attack-panel.ts#L52)).

---

## Approach

### 1. Authoring: `durationSec` on the attack, beside `prepareTimeSec`

```ts
// AttackDefinition (shared/src/types.ts)
/**
 * Seconds the strike's debuff effects stay in force, in *game* seconds. Active
 * attacks only, and required when the attack carries a duration-consuming
 * effect (`enemyProductionModifier` / `enemyCostModifier`); forbidden on a
 * passive attack, which is always-on by definition.
 */
readonly durationSec?: number
```

Plus `durationSec: z.number().positive().optional()` on `AttackSchema`
([tree/schema.ts:87](../../shared/src/tree/schema.ts#L87)).

Definition-level rather than per-effect: it mirrors `prepareTimeSec`, keeps the
window a property of the _attack_ (one countdown to show, one entry to store),
and avoids the question of what two effects with different durations on one
attack would mean. A single attack may still carry several effects — they share
the window.

### 2. Hosts: the one-line unlock

`enemyProductionModifier.hosts` → `['passiveAttack', 'activeAttack']`, same for
`enemyCostModifier`. The generic `checkHost` loop and the `/dev.html` effect
picker both read the declaration, so the editor starts offering these effects on
active attacks with no editor change at all.

Note what this does _not_ do: an `activeAttack` host alone would make the effect
authorable and inert, because `collectEnemyDebuffs` filters to `passive`. §4 is
what makes it fire.

### 3. Runtime state: `activeDebuffs` on the **attacker**

```ts
/** An offensive debuff window opened by a landed active attack. */
export interface ActiveDebuff {
  /** Attack id (matches {@link AttackDefinition.id}). */
  readonly attack: string
  /** `meta.gameSec` value at which the window closes. */
  readonly expiresAtSec: number
}

// PlayerState
/** Debuff windows this player's landed active attacks are currently inflicting. */
activeDebuffs?: ActiveDebuff[]
```

A near-twin of `pendingAttacks`, and deliberately on the **attacker**, not the
victim:

- `collectEnemyDebuffs` / `collectEnemyCostFactors` are already attacker-keyed
  and already gather from attack definitions. Storing the window on the attacker
  makes them one filter longer; storing it on the victim would mean a second,
  victim-side gathering path with its own copy of the "which effects does this
  attack carry" logic.
- The attacker's own client can then render "you are inflicting X for 8s more" —
  feedback for an attack that otherwise produces one toast and nothing else.
- `incomingCostFactors` stays exactly what it is: a server-stamped projection
  onto the victim ([types.ts:173-188](../../shared/src/types.ts#L173-L188)), now
  with a time-varying source. `syncCostFactors` already re-runs often enough.

Optional (absent rather than empty) so a quiet round carries no extra payload —
the same convention `incomingCostFactors` uses. `EMPTY_PLAYER_STATE`
([game.ts:168](../../client/src/game.ts#L168)), `probeState`
([unlock-gates.ts](../../shared/src/unlock-gates.ts)) and `clonePlayerState`
([game.ts:897](../../client/src/game.ts#L897)) each need the field handled; the
first two trivially, the third with a copy of the array.

### 4. Collection: filter at read time, sweep only for hygiene

```ts
export function collectEnemyDebuffs(attacker, mode): Modifier[] {
  // …existing pass over unlocked *passive* attacks…

  const gameSec = (attacker.meta.gameSec as number | undefined) ?? 0
  for (const window of attacker.activeDebuffs ?? []) {
    if (window.expiresAtSec <= gameSec) continue
    const attack = attackById.get(window.attack)
    // …gather `enemyModifier` outputs exactly as the passive pass does…
  }
}
```

Three properties worth stating explicitly, because they are what keeps this
change small:

1. **No signature change.** `gameSec` is read off the attacker's own `meta`, as
   `applyAttackActivation` does, so all four call sites
   ([match.ts:528](../../server/src/match.ts#L528),
   [:639](../../server/src/match.ts#L639),
   [:719-720](../../server/src/match.ts#L719-L720)) are untouched.
2. **Correctness comes from the read-time filter, not from the sweep.** An
   expired window that is still in the array contributes nothing. The tick sweep
   (§5) exists to bound the array and keep the wire small — if it were skipped
   entirely, the mechanic would still be correct.
3. **No unlock re-check.** The passive pass goes through
   `unlockedAttacks(attacker, mode)`; the window pass must not. The strike already
   landed and was paid for; whether the gating upgrade is still held is not a
   question the engine should be able to answer differently (unlocks are
   monotonic today, so this is future-proofing, not a behavior change).

`collectEnemyCostFactors` gets the identical second pass, which is what makes
"inflate their prices by 5× for 10 seconds" fall out for free.

### 5. Strike resolution and expiry

**Opening the window.** `resolveAttackStrike` grows a third output branch beside
`resourceSteal` / `generatorSteal`: an `enemyModifier` or `enemyCost` output on an
_active_ attack pushes one `ActiveDebuff` onto `attacker.activeDebuffs` (once per
attack, not once per effect) and returns a new strike result so the event feed can
report it:

```ts
export interface DebuffStrikeResult {
  readonly kind: 'debuff'
  readonly durationSec: number
}
```

`AttackStrikeResult` gains the member, `AttackEvent` gains the matching
`DebuffAttackEvent { kind: 'debuff'; durationSec }`, and `showAttackEvents`
([game.ts:846](../../client/src/game.ts#L846)) gains a branch — outgoing
"`⚔️ Blockade: enemy slowed for 12s`" (success), incoming "`⚔️ Blockade:
production cut for 12s`" (danger, with the existing shake). A window that opens is
never a "miss", so the `kind: 'none'` path is unaffected.

**Closing it.** A sweep in `resolveDueAttacks` (or a sibling
`expireActiveDebuffs`) drops entries with `expiresAtSec <= gameSec`, using the
same filter shape as
[match.ts:600](../../server/src/match.ts#L600). Ordering consequence to accept and
document: `applyPassiveIncome` runs _before_ `resolveDueAttacks` in the tick
([match.ts:363-371](../../server/src/match.ts#L363-L371)), and income reads the
window list through `collectEnemyDebuffs`' own expiry filter — so a window is
worth whole ticks at `TICK_INTERVAL_MS` granularity, exactly as `prepareTimeSec`
already is.

### 6. Re-activation while a window is open

`attackBlockReason` gains `'already-active'`, checked beside
`'already-preparing'` ([attacks.ts:60](../../shared/src/attacks.ts#L60)):

```ts
if (state.activeDebuffs?.some((w) => w.attack === attackId && w.expiresAtSec > gameSec))
  return 'already-active'
```

Blocking is the cheap, legible option: no stacking arithmetic, no refresh-vs-extend
decision, and the panel can show a countdown instead of a price. `blockLabel`
renders it as the remaining time (it already has `pendingRemaining`
([attack-panel.ts:43](../../client/src/ui/panels/attack-panel.ts#L43)) to copy),
so the card reads `Active for 7.4s` rather than a generic "blocked".

Rejected: stacking the same attack (two windows of `0.5` multiply to `0.25` and
the mechanic gets away from the balance envelope fast) and refreshing (a player
spamming one attack pays repeatedly for a window they already have, which reads as
a bug). _Different_ attacks stack freely — they are separate modifiers in the
pipeline, which is exactly how two passive attacks already compose.

### 7. Client: prediction stays out of it

The client predicts `activate_attack`
([game.ts:564](../../client/src/game.ts#L564), replayed at
[game.ts:761-766](../../client/src/game.ts#L761-L766)) — the cost and the pending
entry. It must **not** predict the window: the strike lands server-side, and
`ackSeq` already guarantees a replayed activation cannot double-apply after the
server resolved it. `activeDebuffs` therefore arrives like any other `PlayerState`
field and needs zero reconciliation code.

Display work, all of it additive:

- **Attacker side** — `renderActiveAttack`
  ([attack-panel.ts:64](../../client/src/ui/panels/attack-panel.ts#L64)) shows
  `Active for N.Ns` while the player's own window is open, from
  `state.player.activeDebuffs`; the card's status line already has three states
  (preparing / blocked / cost) and this is a fourth.
- **Victim side** — the existing debuff rows in the data panel light up and go
  dark on their own, because `state.debuffs` simply starts and stops carrying the
  modifier. No new code; see open question 1 for the countdown.

### 8. Boot validation

Extend the active-attack cost/timing block
([modes/index.ts:387-418](../../shared/src/modes/index.ts#L387-L418)), which
already owns exactly this kind of rule:

- `durationSec` on a `passive` attack → throw (it is always-on; a window is
  meaningless).
- An `active` attack carrying an `enemyModifier`- or `enemyCost`-emitting effect
  with no `durationSec` → throw. Without a window the effect would be gathered
  never and the attack would silently do nothing — the failure mode the host
  check exists to prevent.
- `durationSec` on an active attack whose effects are all steals → throw. It is
  authored dead weight, and the countdown UI would show a window with nothing in
  it.
- `durationSec <= 0` → throw (the schema's `.positive()` covers the file path;
  the validator covers programmatically built modes, as it already does for
  `prepareTimeSec < 0`).

Both existing per-effect integrity blocks
([modes/index.ts:418-470](../../shared/src/modes/index.ts#L418-L470)) already
assert "a steal may only ride an active attack"; this adds the mirror rule for
the debuff effects, which until now could only ride a passive one.

---

## Balance note (why this is worth doing)

Over a 60-second round, a permanent passive multiplicative debuff of `0.9` costs
the victim `0.10 × 60 = 6` resource-seconds of production. A 10-second window at
`0.5` costs `0.50 × 10 = 5`. They are the same order of magnitude — so the window
form is a legitimate way to spend an attack slot, while _feeling_ completely
different: it is timeable (fire it while they are saving for a tier), it is
survivable, and it is visible to the victim as an event rather than as a
permanently worse world.

That also sets the authoring envelope: a window's value should sit near
`permanent_deficit × round_length / duration`, and a `durationSec` in the 8-20s
range keeps a strong-looking number (`0.4`-`0.6`) inside it. Anything
instantaneous-feeling (`< 5s`) either does nothing or has to be so strong it reads
as a bug.

---

## Files touched

| File                                                                                                               | Change                                                                         |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [shared/src/types.ts](../../shared/src/types.ts)                                                                   | `AttackDefinition.durationSec`, `ActiveDebuff`, `PlayerState.activeDebuffs`    |
| [shared/src/tree/schema.ts](../../shared/src/tree/schema.ts)                                                       | `durationSec` on `AttackSchema`                                                |
| [shared/src/attacks.ts](../../shared/src/attacks.ts)                                                               | `'already-active'`, window push in `resolveAttackStrike`, `DebuffStrikeResult` |
| [shared/src/modes/index.ts](../../shared/src/modes/index.ts)                                                       | window pass in both collectors; validation rules                               |
| [shared/src/effects/seed/enemy-production-modifier.ts](../../shared/src/effects/seed/enemy-production-modifier.ts) | `hosts` += `activeAttack`, doc update                                          |
| [shared/src/effects/seed/enemy-cost-modifier.ts](../../shared/src/effects/seed/enemy-cost-modifier.ts)             | `hosts` += `activeAttack`, doc update                                          |
| [shared/src/effects/types.ts](../../shared/src/effects/types.ts)                                                   | `EffectHost` doc: `activeAttack` keeps debuff outputs too                      |
| [shared/src/messages.ts](../../shared/src/messages.ts)                                                             | `DebuffAttackEvent` in the `AttackEvent` union                                 |
| [server/src/match.ts](../../server/src/match.ts)                                                                   | expiry sweep + debuff event pair in `resolveDueAttacks`                        |
| [client/src/game.ts](../../client/src/game.ts)                                                                     | `activeDebuffs` in empty/clone state; toast branch                             |
| [client/src/ui/panels/attack-panel.ts](../../client/src/ui/panels/attack-panel.ts)                                 | `Active for N.Ns` status, `already-active` label                               |
| [client/src/style.css](../../client/src/style.css)                                                                 | an `attack-status--active` class                                               |

No new action type, no new client→server message, and `OpponentView`
([messages.ts:166](../../shared/src/messages.ts#L166)) is built field-by-field, so
the new `PlayerState` field leaks no intel by default.

---

## Tests

**shared/tests/attacks.test.ts** (extend)

- `resolveAttackStrike` on an active attack with a debuff effect pushes exactly
  one `activeDebuffs` entry at `gameSec + durationSec`, returns a
  `kind: 'debuff'` result, and moves no resources.
- An attack carrying a steal _and_ a debuff does both, and still pushes one
  window.
- `attackBlockReason` returns `'already-active'` while the window is open and
  `null` once `gameSec` passes `expiresAtSec`.

**shared/tests/effects.test.ts / modes tests** (extend)

- `collectEnemyDebuffs` includes an unexpired window's modifier, excludes an
  expired one, and excludes a window whose attack id is unknown.
- A window is gathered even when the gating upgrade is absent (no unlock
  re-check).
- `collectEnemyCostFactors` does the same for `enemyCost` outputs.
- Two different windows stack; a passive attack and a window compose.
- Host placement now permits `enemyProductionModifier` on an active attack and
  still rejects `stealResource` on a passive one.

**shared/tests/flavor.test.ts** (extend) — each of the four validation throws in
§8, by message.

**server/tests/match.test.ts** (extend)

- A duration attack activated, prepared, and landed: the victim's income drops
  for the window's ticks and recovers afterwards, and the attacker's
  `activeDebuffs` is swept once expired.
- A duration `enemyCostModifier` raises the victim's quoted price mid-window and
  not after — the victim's `incomingCostFactors` is stamped and then cleared by
  `syncCostFactors`.
- Both sides receive one `kind: 'debuff'` event, once.

**client/tests/** — a DOM test for the `Active for N.Ns` status and the
`already-active` disabled state, plus a toast assertion for the new event kind
(`toast.dom.test.ts` has the pattern).

---

## Open questions

1. **Victim-side countdown needs a wire change — ship without it?**
   `STATE_UPDATE.debuffs` is a bare `Modifier[]`
   ([messages.ts:207](../../shared/src/messages.ts#L207)) with no provenance and
   no expiry, so the victim can see _what_ is hitting them but not for how much
   longer. Proposed: v1 ships without the countdown (the debuff rows appear and
   disappear, and the incoming toast states the duration). If the countdown is
   wanted, the smallest addition is a sibling `debuffsUntilSec?: number` (the
   latest expiry) or a per-entry `{ modifier, untilSec }` shape — the latter
   changes the type every debuff consumer reads, so it should be a deliberate,
   separate change.
2. **Does a window survive a pause?** Everything is in game seconds and
   `meta.gameSec` freezes with the round
   ([types.ts:129-135](../../shared/src/types.ts#L129-L135)), so yes, automatically
   — worth an explicit test in the paused-match suite rather than an assumption.
3. **Should an attack be allowed to carry both a steal and a window?** Permitted
   above (one strike, both consequences). The alternative — one output kind per
   attack — is simpler to describe on a card but forbids the obvious "raid: take
   10% and slow them while they rebuild."
4. **Same attack, second window after expiry:** allowed (the block is only while
   active), so a cheap short window can be spammed. If that proves degenerate the
   lever is a cooldown field, which is a third timestamp on the attack and a
   fourth block reason — deliberately out of scope here.

---

## Deferred

- **Simulator support.** `shared/src/simulation/` has no attack handling at all,
  so windows do not appear in strategy runs. Owed since
  [plan 29](29-active-attacks.md).
- **Bot support.** `server/src/bot.ts` never activates an attack, so a bot will
  never open a window.
- **Authoring on the idler tree** — separate pass, in `/dev.html`.
