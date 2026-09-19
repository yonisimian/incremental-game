# 41 — Attack alert: an early warning before an enemy strike lands

## Status: Implemented (branch `feat/9-attack-alert`)

### As built — departures from the text below

- **The balance note was resolved first, as data.** A preceding commit
  staggered the active attacks' prepare times — Steal Wood 6s, Poach Sawmill
  8s, Numb Hands 8s, Steal Woodcutters 10s, Embargo 10s, Termite Swarm 15s
  (Steal Ale and Fog of War stay at 3s as the cheap, untelegraphed options) —
  so the 5s base lead is a real telegraph and every `d-as` level buys
  something. Open question 1 resolved: **`d-as` has five levels** (a 10s
  maximum lead).
- **The bot raids from surplus, not from a reserve.** §8's "leave the plan
  target affordable" rule collapses in practice: while a plan step is
  unaffordable the reserve always exceeds the wallet, and once it is
  affordable it is bought the same tick. So the bot fires only **once its plan
  is exhausted**, from whatever is left after that tick's buys. To make "left
  after this tick's buys" true, one wallet is now threaded through `decide` —
  plan buy, generator buys, then the raid — so the bot never emits two actions
  that are each affordable but not together.
- **Toast copy** reads `⚠️ Incoming attack in 4.0s` / `⚠️ 🪓 Steal Wood in
4.0s` (`toFixed(1)`, matching the panel countdowns, not `formatDecimal`); the
  espionage line reads `⚠️ Enemy attack lands in 4.0s.`
- **The badge lives in its own module**, `client/src/ui/attack-alert.ts`, with
  `role="status"`, so it tests at the DOM tier without mocking the game. It
  anchors on a change of the snapshot's `meta.gameSec` (a local click notifies
  the UI but moves no clock, so it re-anchors nothing).
- **The editor checkbox** reads and writes three shapes: a bare gate, `all` of
  `[upgrades…, gate]`, and `all` of `[any(upgrades…), gate]`; anything else
  still falls through to the JSON textarea. Its `isHitByAttack` does not
  compare the key, since the whitelist has one member and ESLint flags the
  always-true comparison — the comment says where to add it back.
- **The editor's picker** files `attackAlert` under a new "Defense" group
  (the effect-groups test requires every registered effect to be grouped).
- **Server tests** patch the idler with three throwaway alert nodes rather than
  depend on the authored ones, so stage 4 was green before stage 7 existed.

Full suite green: shared 837, server 172, client 505. `typecheck`, `lint`,
`lint:css`, `lint:exports`, `format:check`, `check:balance` and
`lint:instructions` all pass. Main client bundle 30.7 kB raw (budget 60/80).

---

Decisions taken (2026-09-19):

- **Surface:** an always-visible header badge under the Quit button, plus a
  `warning` toast when a strike first comes into view, plus a line in the
  espionage panel's "Enemy Attacks" section.
- **What counts as "attacked":** only a **landed active strike** — one that
  moved a resource or generator, or opened a debuff window. A strike that moved
  nothing (`kind: 'none'`) does not count; passive attacks never count.
- **Gate:** `d-alert` is locked in the tree until the player has been hit at
  least once. This needs a new prerequisite kind (§1).
- **`d-as` is repeatable** — several levels, each adding one second.
- **`d-aa` reveals the attack's name**, nothing in between for now.
- **Costs stay free** (`"cost": {}`); tuning is a later pass.
- **The bot learns to fire attacks** if it stays a small change (§8) — without
  it the alert is only testable with two humans.

---

## Goal

Today a victim learns about an active attack when it has already landed. The
attacker's `pendingAttacks` are never sent to the opponent, so the 3-second
preparation is invisible to the one player it matters to. The three `d-*` nodes
in the tree describe the counterplay this plan builds: a warning `leadSec`
before the strike, extendable by one second per level, and optionally naming
the attack — so the victim can spend the wood about to be stolen, buy before the
embargo lands, or release the highlight before the debuff bites.

Ship **mechanic + validation + editor + UI + idler authoring + tests**, in
stages that each land as one commit (see [Implementation stages](#implementation-stages)).

---

## What already exists (verified)

- **Pending strikes are attacker-side state.** `applyAttackActivation`
  ([attacks.ts](../../shared/src/attacks.ts#L393)) pushes
  `{ attack, readyAtSec }` onto the attacker's `pendingAttacks`, stamped from
  the attacker's `meta.gameSec`. `resolveDueAttacks`
  ([match.ts](../../server/src/match.ts#L563)) lands them and emits one
  `AttackEvent` to each side.
- **Both players' game clocks advance in lockstep.** The tick loop calls
  `applyPassiveIncome` for both players with the same `tickSec`
  ([match.ts](../../server/src/match.ts#L363)), and a pause freezes both. So a
  `readyAtSec` stamped on the attacker's clock reads correctly against the
  victim's `meta.gameSec` — the attacker's own card already does exactly this
  ([attack-panel.ts `pendingRemaining`](../../client/src/ui/panels/attack-panel.ts#L95)).
- **The opponent view is redacted field by field.** `opponentViewFor`
  ([match.ts](../../server/src/match.ts#L798)) adds a field only when the
  viewer's `accessEnemyData` grant covers it. A new field leaks nothing unless
  it is written.
- **Toasts have a reserved variant for this.** Plan 31 shipped `spawnToast` with
  `warning` "for future incoming" and it still has no live trigger.
- **The espionage panel already has an ungated "Enemy Attacks" section**
  ([espionage-panel.ts `renderIncomingDebuffs`](../../client/src/ui/panels/espionage-panel.ts#L121))
  that lists what is being done _to_ the player.
- **The header interpolates the timer between broadcasts** on a rAF loop
  ([playing.ts](../../client/src/ui/playing.ts#L167)), and the battery bar
  extrapolates display-only between snapshots. A countdown badge beside a
  smooth timer should not step in half-seconds.
- **Prerequisites test owned upgrades only.** `PrerequisiteExpression` is
  `upgrade | all | any` ([types.ts](../../shared/src/types.ts#L1)); evaluation
  ([prerequisites.ts](../../shared/src/prerequisites.ts#L18)) already receives
  the full `PlayerState`, so a state-reading prerequisite is a new union member,
  not a signature change. Call sites: `purchaseBlockReason`, the client's
  optimistic buy and replay, the tree panel's lock display, and the dev
  strategies — all through `isPrerequisiteSatisfied`.
- **The additive-grant collector pattern.** `attackLimit`
  ([attacks.ts](../../shared/src/attacks.ts#L646)) folds an `attackSlots` output
  as `value × owned` over owned upgrades plus the mode's effects. The alert lead
  is the same shape.
- **The bot never attacks.** `BotAction` ([bot.ts](../../server/src/bot.ts#L29))
  has no `activate_attack`; `processBotActions` has no branch for it.
- **The three nodes exist as layout only.** [`d-alert`](../../shared/trees/idler.json#L2891)
  hangs under `e-se-mr` with no prerequisites, no effects and `"cost": {}`;
  `d-as` / `d-aa` require `d-alert` and are `purchaseLimit: 1`.

---

## Approach

### 1. A state-reading prerequisite: `{ type: 'meta', key, min }`

```ts
// shared/src/types.ts
export type PrerequisiteExpression =
  | { readonly type: 'all'; readonly items: readonly PrerequisiteExpression[] }
  | { readonly type: 'any'; readonly items: readonly PrerequisiteExpression[] }
  | { readonly type: 'upgrade'; readonly id: string; readonly minLevel?: number }
  | {
      /** Satisfied once `state.meta[key]` (a counter the server stamps) reaches `min`. */
      readonly type: 'meta'
      readonly key: PrerequisiteMetaKey
      readonly min: number
    }
```

`PrerequisiteMetaKey` is a **whitelist**, not a free string — a typo must fail
at boot, not silently lock a node forever:

```ts
// shared/src/prerequisites.ts
export const PREREQUISITE_META_KEYS = ['attacksSuffered'] as const
export type PrerequisiteMetaKey = (typeof PREREQUISITE_META_KEYS)[number]

/** Display label per key, for `formatPrerequisiteExpression` and the editor. */
export const PREREQUISITE_META_LABELS: Record<PrerequisiteMetaKey, string> = {
  attacksSuffered: 'being hit by an enemy attack',
}
```

Changes in `prerequisites.ts`, each one branch:

- `evaluatePrerequisiteExpression`: `(state.meta[key] as number ?? 0) >= min`.
- `getPrerequisiteUpgradeIds`: skip (it names no upgrade; the cycle check is
  unaffected).
- `formatPrerequisiteExpression`: `min === 1 ? label : \`${label} ×${min}\``,
  so the tree popup reads "Requires being hit by an enemy attack".
- `validatePrerequisiteExpression`: `key` in the whitelist, `min` a positive
  integer.

`PrerequisiteSchema` in [tree/schema.ts](../../shared/src/tree/schema.ts#L42)
gains the fourth `strictObject` with `key: z.enum(PREREQUISITE_META_KEYS)`.

Why a generic `meta` kind rather than `{ type: 'attacked' }`: the evaluation is
one line either way, but the generic form also covers "peak CPS ≥ 10" or "held
the highlight for 30 s" later with no new prerequisite code — only a new
whitelist entry and a server stamp.

**Simulator consequence, accepted:** `simulate` is single-player and never
stamps `attacksSuffered`, so a `meta`-gated node is unbuyable in every strategy
run. For an intel node that is the correct answer (it has no production value
to measure). `validateStrategyForMode` needs no change — a strategy that buys
`d-alert` fails the same `prerequisite` reason any premature buy does.

### 2. The server stamps `meta.attacksSuffered` on the victim

In `resolveDueAttacks`, in the branch where `moved.length > 0`:

```ts
victim.state.meta.attacksSuffered = ((victim.state.meta.attacksSuffered as number) ?? 0) + 1
```

Not in the `moved.length === 0` branch — per the decision above, a miss is not a
hit. Not for passive attacks — they never pass through this function. The stamp
rides `PlayerState.meta` to the victim's client in the same snapshot as the
`incoming` event, so the tree node unlocks in the same frame the toast lands,
and an optimistic buy of `d-alert` immediately afterwards reconciles cleanly
(the replay re-checks the prerequisite against the server snapshot, which
carries the counter).

`meta` is reset with the rest of the state at round start; nothing to add.

### 3. The `attackAlert` effect and its collector

```ts
// shared/src/effects/seed/attack-alert.ts
const schema = z
  .strictObject({
    /** Seconds of warning granted, per owned level. */
    leadSec: z.number().positive().optional(),
    /** Whether the warning names the incoming attack. */
    revealAttack: z.boolean().optional(),
  })
  .refine((p) => p.leadSec !== undefined || p.revealAttack === true, {
    message: 'attackAlert must grant a lead, a reveal, or both',
  })

function apply(p): AttackAlertOutput {
  return { kind: 'attackAlert', leadSec: p.leadSec ?? 0, revealAttack: p.revealAttack ?? false }
}
```

Hosts: the default (mode + upgrade). Registered in
[effects/index.ts](../../shared/src/effects/index.ts) like every seed.

The collector, in `attacks.ts` beside `attackLimit` and shaped like it:

```ts
export interface AttackAlert {
  /** Total seconds of warning; `0` when no alert is owned. */
  readonly leadSec: number
  /** Whether the warning may name the attack. */
  readonly revealAttack: boolean
}

export function collectAttackAlert(state, mode): AttackAlert
// leadSec = Σ (out.leadSec × owned); revealAttack = any owned grant says true.
```

`leadSec` scales with `owned`, which is what makes `d-as` a multi-level node
with one authored ref. `revealAttack` is a flag and does not scale.

### 4. Wire: `OpponentView.incomingAttacks`

```ts
// shared/src/messages.ts
/**
 * An enemy strike due to land on the receiving player within their alert lead.
 * Present only while the viewer owns an `attackAlert` grant and at least one
 * pending enemy strike is inside it. The full current list every broadcast
 * (state, not a delta): a countdown is re-derived, never accumulated.
 */
export interface IncomingAttack {
  /**
   * The attacker's `meta.gameSec` at which it lands. Both players' clocks advance
   * in lockstep, so the viewer counts down against its own `meta.gameSec`, exactly
   * as the attacker's own card does. Also the entry's identity across broadcasts
   * (for toast de-duplication).
   */
  readyAtSec: number
  /** Abstract attack id — present only when the viewer owns `revealAttack`. */
  attack?: string
}

export interface OpponentView {
  // …
  incomingAttacks?: IncomingAttack[]
}
```

Projection, in `opponentViewFor(viewer, opponent, …)`:

```ts
const alert = collectAttackAlert(viewer.state, mode)
if (alert.leadSec > 0) {
  const gameSec = (opponent.state.meta.gameSec as number | undefined) ?? 0
  const soon = opponent.state.pendingAttacks
    .filter((p) => p.readyAtSec - gameSec <= alert.leadSec)
    .map((p) =>
      alert.revealAttack
        ? { readyAtSec: p.readyAtSec, attack: p.attack }
        : { readyAtSec: p.readyAtSec },
    )
  if (soon.length > 0) view.incomingAttacks = soon
}
```

Absent when empty, like every other optional view field. No watermark, no
per-viewer state on `MatchPlayer`: the client replaces its list from each
snapshot. Intel leak accepted and intended: a warned victim learns the opponent
holds an active attack and, with `d-aa`, which one.

### 5. Client: state, toast, espionage line

- `GameState.incomingAttacks: IncomingAttack[]` — **replaced** from
  `msg.opponent.incomingAttacks ?? []` on every `STATE_UPDATE`, cleared on
  round start (same two sites that clear `opponentPurchaseFeed`).
- **Toast**, in the same handler: for each entry whose
  `${readyAtSec}:${attack ?? ''}` key was not in the previous list, one
  `spawnToast('⚠️ Incoming attack in 4.5s', 'warning')`, or
  `'⚠️ 🪓 Steal Wood incoming in 4.5s'` with the reveal. Keyed on the previous
  list rather than a growing set, so nothing needs clearing. The first live
  trigger for the `warning` variant.
- **Espionage line**: `renderIncomingDebuffs` gains
  `⚠️ Enemy attack lands in N.Ns.` / `⚠️ 🪓 Steal Wood lands in N.Ns.` per entry,
  remaining = `readyAtSec - player.meta.gameSec`, floored at 0. Steps at
  snapshot cadence, like the panel's other countdowns.

### 6. Client: the header badge

Rendered inside `.game-header` in [playing.ts](../../client/src/ui/playing.ts#L142),
directly under the Quit button (the two stack in a small column so the timer
and progress bars keep their place):

```html
<div class="header-left">
  <button class="quit-btn" id="quit-btn">← Quit</button>
  <div class="attack-alert" id="attack-alert" hidden>
    <span class="attack-alert-icon">⚠️</span>
    <span class="attack-alert-name" id="attack-alert-name"></span>
    <span class="attack-alert-time" id="attack-alert-time"></span>
  </div>
</div>
```

- Shows the **soonest** entry; if more than one is inside the lead, appends
  `+N`. Name is the flavored attack name when revealed, otherwise "Incoming
  attack".
- **Interpolated**, not stepped: the badge sits beside the interpolated timer, so
  `remaining = (readyAtSec - snapshotGameSec) - (performance.now() - snapshotAt) / 1000`,
  floored at 0, driven by the existing `tickTimerLoop` rAF while any alert is
  live and the match is unpaused. Display-only, like the battery bar's
  extrapolation — every snapshot re-anchors it.
- Reaching 0 shows `now!` until the snapshot that drops the entry (the strike
  landed, and the `danger` toast takes over). Never negative, never a badge that
  silently vanishes before the hit.
- `hidden` toggled via `el.hidden`; a `attack-alert--imminent` class under 2 s
  for a pulse. CSS beside `.quit-btn`; mind the bundle budget.

### 7. Boot validation

In `validateModeDefinition`:

- `revealAttack` granted anywhere in a mode with **no** `leadSec` grant anywhere
  → throw. A reveal with nothing to reveal on is authored dead weight.
- The schema `refine` in §3 rejects an `attackAlert` ref that grants nothing.
- `meta` prerequisite: key in `PREREQUISITE_META_KEYS`, `min` a positive
  integer (§1, in `validatePrerequisiteExpression`).

### 8. Bot: fire unlocked active attacks (small, so yes)

Four pieces, none deep:

1. `BotAction` gains `{ type: 'activate_attack'; attackId: string }`.
2. `processBotActions` gains the branch `processActions` already has:
   `isValidAttackActivation` → `applyAttackActivation`.
3. `IdlerBot`'s plan gains the free attack nodes (`a-unlock` and the unlock
   node for one active attack — the `prepareTimeSec: 3` steal, `a0`), resolved
   through `resolvePath` like the rest of the plan.
4. A decision rule in `decide`: for each unlocked active attack with
   `attackBlockReason === null`, fire it when the prepare cost leaves enough
   spare to still afford the current plan target — the same "don't starve the
   plan" guard `buyGenerators` applies. Bounded to one activation per tick.

That is one union member, one branch, two plan entries and a ~15-line rule. If
the bot's attack starts distorting balance runs, the rule can be gated behind a
`BotStrategy` option later; the dev panel does not run the server bot.

### 9. Dev editor

- The effect form is generated from the zod schema — nothing to do for
  `attackAlert`.
- The inspector's simple prerequisite checklist (`asSimplePrereq` in
  [inspector.ts](../../client/src/dev/editor/inspector.ts#L358)) must return
  `null` for a `meta` node rather than mis-render it, falling through to the
  existing "advanced JSON" textarea. Add one checkbox — "Requires: hit by an
  enemy attack" — that writes `{ type: 'meta', key: 'attacksSuffered', min: 1 }`
  (wrapped in `all` alongside existing upgrade prerequisites), since this is the
  one gate the tree uses today.

### 10. Idler authoring

| Node      | Change                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `d-alert` | `prerequisites: { type: 'meta', key: 'attacksSuffered', min: 1 }`; `effects: [{ type: 'attackAlert', leadSec: 5 }]`                                                                                                                                                      |
| `d-as`    | `purchaseLimit: 5` (open question 1); `effects: [{ type: 'attackAlert', leadSec: 1 }]`                                                                                                                                                                                   |
| `d-aa`    | `effects: [{ type: 'attackAlert', revealAttack: true }]`                                                                                                                                                                                                                 |
| flavor    | `d-alert` → "🛡️ Early warning" / "Get alerted 5 seconds before an enemy attack lands. Unlocks after you have been hit once."; `d-as` → "🛡️ Longer warning" / "+1 second of warning per level."; `d-aa` → "🛡️ Know the attack" / "The warning names the incoming attack." |

Costs stay `{}`.

---

## Balance note — read before authoring

Every active attack currently authored has `prepareTimeSec: 3`
([idler.json](../../shared/trees/idler.json#L109)), and `d-alert` grants a
**5-second** lead. A lead longer than the prepare time means the warning fires
**the moment the attacker activates**, and every `d-as` level past that point
buys nothing. As authored, `d-alert` is "see every activation instantly" and
`d-as` is dead weight until some attack has a prepare time above 5 s.

That is a tuning question, not a code one, and the plan does not decide it.
The levers: raise prepare times on the stronger attacks (a 10-second embargo
prep makes the 5 s lead half a telegraph), or lower the base lead to 2 s so the
`d-as` levels are worth buying. Either is a data edit in `/dev.html`. The
mechanic is built so the lead is clamped by nothing — the alert simply appears
at activation when the lead exceeds the delay — and the attack panel could
later show the attacker "your enemy will see this N s before it lands" once
espionage reveals their alert level.

---

## Files touched

| File                                                                                     | Change                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [shared/src/types.ts](../../shared/src/types.ts)                                         | `meta` member of `PrerequisiteExpression`                                       |
| [shared/src/prerequisites.ts](../../shared/src/prerequisites.ts)                         | whitelist + labels; evaluate / ids / format / validate branches                 |
| [shared/src/tree/schema.ts](../../shared/src/tree/schema.ts)                             | `meta` member of `PrerequisiteSchema`                                           |
| `shared/src/effects/seed/attack-alert.ts` (new)                                          | the effect                                                                      |
| [shared/src/effects/types.ts](../../shared/src/effects/types.ts)                         | `AttackAlertOutput`, added to `EffectOutput`                                    |
| [shared/src/effects/index.ts](../../shared/src/effects/index.ts)                         | register `attackAlert`                                                          |
| [shared/src/attacks.ts](../../shared/src/attacks.ts)                                     | `AttackAlert`, `collectAttackAlert`                                             |
| [shared/src/modes/index.ts](../../shared/src/modes/index.ts)                             | reveal-without-lead boot rule                                                   |
| [shared/src/messages.ts](../../shared/src/messages.ts)                                   | `IncomingAttack`, `OpponentView.incomingAttacks`                                |
| [server/src/match.ts](../../server/src/match.ts)                                         | `attacksSuffered` stamp; projection in `opponentViewFor`; bot `activate_attack` |
| [server/src/bot.ts](../../server/src/bot.ts)                                             | `BotAction` member, plan entries, fire rule                                     |
| [client/src/game.ts](../../client/src/game.ts)                                           | `incomingAttacks` state, replace-on-snapshot, clear-on-start, warning toast     |
| [client/src/ui/playing.ts](../../client/src/ui/playing.ts)                               | header badge markup, interpolation in the rAF loop, update                      |
| [client/src/ui/panels/espionage-panel.ts](../../client/src/ui/panels/espionage-panel.ts) | incoming line in "Enemy Attacks"                                                |
| [client/src/style.css](../../client/src/style.css)                                       | `.header-left`, `.attack-alert*`                                                |
| [client/src/dev/editor/inspector.ts](../../client/src/dev/editor/inspector.ts)           | `meta` tolerance in the simple checklist; "hit by attack" checkbox              |
| [shared/trees/idler.json](../../shared/trees/idler.json)                                 | `d-alert` / `d-as` / `d-aa` effects, prerequisite, levels, flavor               |

No new client → server message. `PlayerState` gains no field — the counter is a
`meta` key like `peakCps`.

## Data / type changes

- `PrerequisiteExpression` grows a member; every exhaustive switch over it (the
  four functions in `prerequisites.ts`, the editor's `asSimplePrereq`) is
  named by `pnpm typecheck`.
- New output kind `attackAlert`; every existing consumer ignores unknown kinds.
- New optional wire field `OpponentView.incomingAttacks`.
- New `meta` key `attacksSuffered` (server-stamped, victim-side, integer).

---

## Tests

**shared/tests/prerequisites.test.ts** (extend)

- `meta` evaluates against `state.meta[key]`, absent reads as 0, `min` inclusive.
- `getPrerequisiteUpgradeIds` omits it; cycle detection is unaffected by it.
- `formatPrerequisiteExpression` renders the label, with `×N` for `min > 1`.
- Validation rejects an unknown key, `min: 0`, and a non-integer `min`.
- `PrerequisiteSchema` accepts the `meta` form and rejects a key outside the
  whitelist.

**shared/tests/attacks.test.ts** (extend)

- `collectAttackAlert`: `{0, false}` with nothing owned; lead sums
  `leadSec × owned` across upgrades and the mode; reveal is true if any owned
  grant says so, and a reveal grant alone contributes no lead.
- `attackAlert` schema rejects a ref granting neither lead nor reveal.

**shared/tests/flavor.test.ts / modes** (extend)

- Reveal-without-lead throws, by message.
- Idler boots with the authored nodes (`project.test.ts`).

**server/tests/match.test.ts** (extend)

- A landed steal increments the **victim's** `meta.attacksSuffered`; a strike
  that moved nothing does not; the attacker's counter is untouched.
- `incomingAttacks` is absent for a viewer with no grant; absent when the
  pending strike is outside the lead; present, with the right `readyAtSec`, once
  inside; carries `attack` only with the reveal grant. Assert on the serialized
  message, as the `pendingAttacks` redaction test does.
- The list disappears from the broadcast after the strike lands.
- Bot: `activate_attack` from `decide` is validated and applied; an
  unaffordable one is skipped; the bot never fires while it would starve its
  plan target.

**client/tests** (extend)

- `game.test.ts`: `incomingAttacks` replaced per snapshot, cleared on round
  start; exactly one `warning` toast per new `readyAtSec`, none on the
  rebroadcast of an unchanged list.
- A DOM test for the badge: hidden with no alerts; shows the soonest entry; `+1`
  with two; "Incoming attack" without reveal and the flavored name with it;
  never renders a negative time.
- Espionage panel: the incoming line appears and disappears with the list.
- Editor: `asSimplePrereq` returns `null` for a `meta` prerequisite; the
  checkbox round-trips.

Full gate before push: `pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css`.
Rebuild shared (`pnpm --filter @game/shared build`) before server/client suites.

---

## Implementation stages

Each stage is one commit, reviewable alone, and leaves every suite green. The
mechanic is unreachable by a player until stage 7.

1. **`feat(prereqs): meta prerequisite kind`** — §1: type, schema, whitelist,
   labels, the four branches, tests. Nothing authored, nothing stamps the key
   yet.
2. **`feat(attacks): stamp attacksSuffered on the victim of a landed strike`** —
   §2 plus its server tests. A `meta`-gated node would now unlock, but none is
   authored.
3. **`feat(attacks): attackAlert effect and collector`** — §3 and the
   reveal-without-lead rule of §7, with shared tests. Registered, collectable,
   consumed by nothing.
4. **`feat(net): incomingAttacks on the opponent view`** — §4: wire type and the
   projection in `opponentViewFor`, server tests including the redaction
   assertions. The client ignores the field.
5. **`feat(client): incoming-attack toast and espionage line`** — §5: state,
   replace/clear, the `warning` toast, the espionage line, client tests.
6. **`feat(client): header attack-alert badge`** — §6: markup under Quit,
   interpolation on the timer loop, CSS, DOM tests.
7. **`feat(idler): author the early-warning nodes`** — §10: effects,
   prerequisite, `d-as` levels, flavor. The first commit where a player can
   reach the mechanic. Includes the balance note above in the commit body so
   the 5 s-vs-3 s mismatch is on record.
8. **`feat(editor): author a meta prerequisite`** — §9: `asSimplePrereq`
   tolerance and the checkbox. Could precede stage 7 if hand-editing the JSON
   is unwanted; ordered after so the tree change is not blocked on editor work.
9. **`feat(bot): fire unlocked active attacks`** — §8. Last and optional: the
   alert works without it, but with it a solo player sees the badge.

---

## Open questions

1. **How many `d-as` levels?** _Resolved: five_ (a 10-second maximum lead).
   Still one field to change.
2. **Should the toast fire at all when the badge is always visible?** Kept — the
   badge is small and the toast is what pulls the eye off a panel. Drop it if it
   reads as double-announcing.
3. **Should the alert also count passive-attack unlocks in some later tier?**
   Out of scope; noted because `d-aa`'s "which attack" wording could later grow
   to "which attacks they hold".

---

## Deferred

- **Tuning** the lead against prepare times (balance note). Data only.
- **A middle reveal tier** (steal vs. debuff without the name) — the
  `revealAttack` flag would become an enum; the wire field would gain `kind`.
- **Attacker-side feedback** ("your enemy will see this 5 s early") — needs
  espionage into the opponent's `d-*` ownership.
- **Simulator** modelling of alerts — blind, as every attack plan since 29.
