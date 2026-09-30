# 47 — Attack cooldown: a rest after an active attack finishes

## Status: Planned

The attack half of [43 — activation cooldowns](43-activation-cooldowns.md), with
43's open questions settled and every touch point verified against the current
code. The pact half stays with [44 — active pacts](44-active-pacts.md); the
state field is shaped so 44 can reuse it without a migration.

Template: `durationSec` + the `duration` stat
([37 — duration active attacks](37-duration-active-attacks.md), commit
`6b1c72d`, #138). Almost every change below is "do what `duration` did, one row
further".

---

## Goal

Today an active attack can be re-activated the tick its debuff window closes
(or, with no window, the tick it lands); the prepare cost is the only brake.

Add an authored **`cooldownSec`** to active attacks. When the attack
**finishes** — its debuff window closes, or the strike lands for an attack with
no window — a timer starts. Until it elapses the attack **cannot be activated,
however much the player can afford**. The timer runs in game seconds, so it
freezes with a paused round.

A new **`cooldown` attack stat** lets upgrades shorten it (`mult` / `add` /
`offset`), with the same boot validation as `prepareTime`.

---

## Decisions (43's open questions, settled)

| Question                                        | Decision                                                     | Why                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Starts at window close or strike?               | **Window close** (strike when there is no window).           | As asked: "after an attack is finished".                                                                                                      |
| State shape                                     | One generic `PlayerState.cooldowns: {kind, id, untilSec}[]`. | 44 reuses it for pacts; `kind` keeps the id namespaces apart.                                                                                 |
| Frozen or live stat?                            | **Frozen at the strike** into `untilSec`.                    | Same rule as `prepareTime` (frozen at activation) and `duration` (frozen at the strike). An upgrade bought mid-rest shortens the _next_ rest. |
| `cooldownSec: 0` legal?                         | No — `.positive()`.                                          | `0` is dead weight, same as `durationSec`. The editor clears the field on `≤ 0`.                                                              |
| Card: merge "active" and "cooling"?             | Two states.                                                  | The player learns the rhythm; they are one enum member apart.                                                                                 |
| Allowed on an effect-less (placeholder) active? | Yes.                                                         | Consistent with `prepareTimeSec`.                                                                                                             |

Out of scope: a global cooldown shared by all attacks (a per-kind grant beside
`attackSlots` — a different mechanic); a "ready again" toast (would drown the
strike toasts; the card is the surface).

---

## Approach

### 1. Data — `cooldownSec`

- `AttackDefinition` ([types.ts:143-181](../../shared/src/types.ts#L143)):
  `readonly cooldownSec?: number`, documented beside `durationSec`.
- `AttackSchema` ([tree/schema.ts:94-101](../../shared/src/tree/schema.ts#L94)):
  `cooldownSec: z.number().positive().optional()`. `PactSchema` still rejects it
  (strict object).
- **No `CURRENT_TREE_VERSION` bump** — `durationSec` landed as an optional
  field at version 5 too; `codec.ts` passes `tree.attacks` through unchanged.

### 2. State — `PlayerState.cooldowns`

```ts
// types.ts, beside ActiveDebuff
export interface Cooldown {
  readonly kind: 'attack' | 'pact'
  readonly id: string
  /** The owner's `meta.gameSec` at which the cooldown lifts. */
  readonly untilSec: number
}

// PlayerState
/** Absent when empty. Server-stamped, never predicted, only carried. */
cooldowns?: Cooldown[]
```

`STATE_UPDATE.player` is the whole `PlayerState`, so the field ships with no
change to [messages.ts](../../shared/src/messages.ts).

New `shared/src/cooldowns.ts` (exported from the barrel; knip flags unused
exports, so export only what is used):

- `cooldownUntilSec(state, kind, id): number | null` — judged at read time
  against `readGameSec(state)`; an elapsed entry reads `null` even before the
  sweep (as `activeDebuffExpiresAtSec` does).
- `startCooldown(state, kind, id, untilSec)` — replaces an existing entry for
  the same `(kind, id)`.
- `sweepCooldowns(state, gameSec)` — drops elapsed entries, deletes the field
  when empty.

### 3. Stamping — inside `resolveAttackStrike`

In [attacks.ts `resolveAttackStrike`](../../shared/src/attacks.ts#L491), right
after the window push (it already mutates `attacker.activeDebuffs` and holds the
attacker's `params`):

```ts
const cooldownSec = getAttackCooldownSec(def, params)
if (cooldownSec > 0)
  startCooldown(attacker, 'attack', def.id, (window?.expiresAtSec ?? gameSec) + cooldownSec)
```

- Stamped **at the strike**, when the window length is already known, so no
  "window closed" event is needed and the sweep stays hygiene.
- A miss (`moved.length === 0`) still stamps — the activation was paid and
  resolved.
- A resolved duration of `0` opens no window → the cooldown starts at the strike.
- Living in shared (not `match.ts`, where 43 put it) keeps it pure and
  unit-testable.

### 4. Enforcement — one block reason

- `AttackBlockReason` ([attacks.ts:294-301](../../shared/src/attacks.ts#L294)):
  add `'cooling-down'` between `'already-active'` and `'unaffordable'`.
- `attackBlockReason` ([attacks.ts:336-355](../../shared/src/attacks.ts#L336)):
  after the `already-active` check,
  `if (cooldownUntilSec(state, 'attack', attackId) !== null) return 'cooling-down'`.
  An open window wins, so a stamped-but-waiting cooldown reads `already-active`
  until the window closes. `cooling-down` beats `unaffordable` — that is the
  "even if I have resources" rule.

This one check covers every path, because they all go through
`attackBlockReason` / `isValidAttackActivation`:

- server player action ([match.ts:502](../../server/src/match.ts#L502)) and bot
  action ([match.ts:551](../../server/src/match.ts#L551));
- the bot's `fireAttack` ([bot.ts:389](../../server/src/bot.ts#L389));
- client prediction ([game.ts:615](../../client/src/game.ts#L615)) and the
  replay of unacked actions on reconcile
  ([game.ts:821](../../client/src/game.ts#L821)).

[validation.ts](../../server/src/validation.ts) only re-exports
`isValidAttackActivation` — no change.

**No prediction race:** the strike removes the pending entry and stamps the
cooldown in the same tick, so one snapshot carries both; while pending, the
client already refuses with `already-preparing`. The client's `gameSec` only
comes from snapshots, so it can only be more conservative than the server.

### 5. Server housekeeping ([match.ts](../../server/src/match.ts))

- `resolveDueAttacks` (~L660): `sweepCooldowns` beside the `activeDebuffs`
  sweep.
- `endRound` (~L1054): `delete p.state.cooldowns` beside the window clear.

### 6. The `cooldown` attack stat

[attack-stat.ts](../../shared/src/effects/seed/attack-stat.ts):

- `ATTACK_STATS` (L13) gains `'cooldown'`.
- `OFFSET_STATS` (L43) gains `'cooldown'` (seconds, like `prepareTime` /
  `duration`).
- `ATTACK_STAT_DIRECTION.cooldown = 'decrease'` (L72-77) — so `mult ∈ (0,1)`,
  `add ∈ (-1,0)`, `offset < 0`, enforced by the existing direction check.

[attacks.ts](../../shared/src/attacks.ts):

- `AttackParams` (L54-76): `cooldown` (factor) + `cooldownOffsetSec`.
- `NEUTRAL_ATTACK_PARAMS` (L84-91): `cooldown: 1, cooldownOffsetSec: 0`.
- `ACTIVE_ONLY_ATTACK_STATS` (L99) gains `'cooldown'`.
- `ATTACK_PARAM_FLOORS` (L124-129): `cooldown: 0` (the `Record<AttackStat>`
  type forces it).
- `collectAttackParams` return (L220-224):
  `cooldownOffsetSec: clampOffsetSec(offsets.cooldown)`.
- New `getAttackCooldownSec(def, params)` — twin of `getAttackPrepareTimeSec`:
  `0` with no `cooldownSec`, else
  `max(0, cooldownSec * params.cooldown + params.cooldownOffsetSec)`.

### 7. Boot validation ([modes/index.ts](../../shared/src/modes/index.ts)) — mirrors `prepareTime`

In `checkAttackStat` (L261-335):

- **Passive target** — already rejected once `cooldown` is in
  `ACTIVE_ONLY_ATTACK_STATS`; extend the message (L294) to name cooldown.
- **No cooldown to move** — beside the `prepareTime` check (L301-305):
  `cooldown` on an attack with no `cooldownSec` throws "…which has no cooldown
  to move".
- **Offset floors it at one copy** — generalize the `prepareTime` offset check
  (L328-332): an `offset` with `value <= -cooldownSec` throws "…already floors
  attack 'X's Ns cooldown to 0 at one copy".
- **Negative `add` reaching zero** within the purchase limit (L270-278) —
  applies to `cooldown` automatically.

In the attack loop (L657-734):

- passive + `cooldownSec` → throw ("always-on, never activated"), beside the
  `prepareCost`/`prepareTimeSec` rule (L666);
- active + `cooldownSec <= 0` → throw (programmatic modes; the schema covers
  files), beside the `prepareTimeSec < 0` rule (L686).

No "needs a debuff" rule: unlike `durationSec`, a cooldown is meaningful on a
steal-only attack.

### 8. Client

- **`clonePlayerState`** ([game.ts:1074](../../client/src/game.ts#L1074)):
  carry `cooldowns` ("never predicted, only carried"). Without it, the replay at
  L821 would validate against a clone with no cooldown.
- **Attack card** ([attack-panel.ts](../../client/src/ui/panels/attack-panel.ts)):
  - `renderActiveAttack` (L138-174): a fifth state after preparing / active —
    `Ready in {}s` via `countdownSpan`, button disabled (`reason ===
'cooling-down'`), class `cooling`.
  - `renderStats` (L100-114): a `Cooldown Ns` line when the stat moved it off
    the authored value, like prepare time / duration.
- **`style.css`**: `.attack-status--cooling`, `.attack-btn.cooling`, modeled
  on the `--active` rules.

### 9. Dev editor

- [model.ts](../../client/src/dev/editor/model.ts): `AttackRow.cooldownSec`
  (L972-989), surfaced in `listAttacks` (L1015), stripped in `setAttackKind`
  (L1092) on a switch to passive, new `setAttackCooldown` (clears on `≤ 0`)
  copied from `setAttackDuration`.
- [views/attacks.ts](../../client/src/dev/editor/views/attacks.ts) (L150-172):
  a `Cooldown /s` input beside the duration input.
- [effect-preview.ts](../../client/src/dev/editor/effect-preview.ts):
  `STAT_LABELS.cooldown`, `hasAbsolute` / `describeLevel` branches resolving
  against `cooldownSec`, and the factor/offset fallback for the new pair.
- [effects-editor.ts](../../client/src/dev/editor/effects-editor.ts): no logic
  change — stat and op pickers derive from `attackStatsFor` /
  `attackStatOpsFor`. Comments only.

### 10. Content (optional, last)

`cooldownSec` on the strong actives in `idler.json` / `idler-alternative.json`
(`termite-swarm`, `numb-hands` first), plus a `cooldown` stat upgrade in the
attack-stats branch. Can ship separately so gameplay is unchanged until tuned.

---

## Tests

**shared**

- `cooldowns.test.ts` (new): start / replace / until / sweep; field deleted
  when empty; `null` for an unknown id; elapsed reads `null` before the sweep;
  attack and pact ids do not collide.
- `attacks.test.ts`:
  - `collectAttackParams` — neutral `toEqual` gains the two keys; cooldown factor
    and offset collected apart.
  - `getAttackCooldownSec` — scales then shifts, floors at 0, `0` with no
    `cooldownSec`.
  - `attackBlockReason` — `cooling-down` inside the rest, `null` at
    `untilSec === gameSec`; `already-active` wins over it; it wins over
    `unaffordable`; a `pact` entry with the same id does not block.
  - `resolveAttackStrike` — windowed strike stamps `expiresAtSec + cooldown`;
    steal-only stamps `gameSec + cooldown`; a miss stamps; no `cooldownSec` → no
    field; attacker's cooldown stat applied; a second strike replaces.
- `effects.test.ts`: `attackStat` accepts cooldown `mult 0.5` / `add -0.2` /
  `offset -2`, rejects `mult 2` / `add 0.2` / `offset 1`.
- `flavor.test.ts` (mode validation): passive + `cooldownSec` throws;
  non-positive throws; accepted on steal-only, debuff and placeholder actives;
  cooldown stat on passive / on no-cooldown attack throws; flooring offset
  throws; negative `add` reaching zero throws; valid stat accepted.
- `tree.test.ts`: schema accepts `cooldownSec`, rejects `0` / negative, still
  rejects it on a pact.

**server** — `match.test.ts`, under `active attacks`:

- snapshot carries `cooldowns` with `untilSec = window end + cooldown`;
- activation during the rest is rejected (nothing pending, nothing paid), even
  with resources granted;
- accepted once elapsed;
- frozen while paused;
- swept once elapsed; cleared at round end;
- steal-only starts at the strike;
- frozen against a cooldown upgrade bought mid-rest.

`bot.test.ts`: the bot does not fire an attack that is cooling down.

**client**

- `attack-panel-stats.test.ts`: `Ready in Ns`, disabled, no price; price back
  once elapsed; open window wins; `Cooldown Ns` stat line.
- `game.test.ts`: `doActivateAttack` refused while cooling; replayed activation
  dropped when the snapshot carries a cooldown; `cooldowns` survives
  reconciliation.
- `editor-model.test.ts`: `listAttacks` / `setAttackCooldown` (set, clear on
  `≤ 0`) / passive switch strips it / result validates.
- `editor-effect-preview.test.ts`: cooldown resolved for `mult` and `offset`;
  factor/offset fallback without `cooldownSec`.
- `editor-effect-fields.test.ts`: passive picker still `['power']`; `cooldown`
  op picker includes `offset`.

---

## Implementation order

1. `feat(attacks): cooldowns module and PlayerState.cooldowns` — §2.
2. `feat(attacks): cooldownSec on attacks, stamped at the strike` — §1, §3, §4,
   §5, §7 (data rules), `clonePlayerState`.
3. `feat(attacks): cooldown attack stat` — §6, §7 (stat rules).
4. `feat(client): attack card cooling state` — §8.
5. `feat(editor): cooldown field and stat preview` — §9.
6. `balance(idler): cooldowns on the strong active attacks` — §10, optional.

Rebuild shared before server/client tests; run
`pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css` before
pushing.
