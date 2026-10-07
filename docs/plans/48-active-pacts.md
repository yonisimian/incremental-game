# 48 — Active pacts: sign, enjoy a window, rest

## Status: Implemented

As built, with these departures from the text below:

- **No `PactEvent`.** `OpponentView.pacts` stays `string[]` and now also lists
  the opponent's open windows that reach the viewer (mutual, or carrying a
  gift); a new `OpponentView.pactWindows` carries their closing times. The
  client's existing "signed by the enemy" toast already fires when a new id
  appears, so each activation announces itself to the partner with no new
  event type. The signer's own toast is raised client-side on the predicted
  activation.
- **No `BotAction` member.** The bot does not sign pacts, so nothing would
  emit it.
- Steps 1–8 landed one commit each, the editor step also moving
  `resourceSelect` into the shared editor controls.

Review follow-ups (PR #167), one commit each:

- **"Partner-directed" is a registry trait.** `EffectDef.partnerDirected`
  (set on `partnerAutoClick`), queried through `isPartnerDirectedEffect`,
  replaces the effect-name checks the validator, `sharedPactWindows` and the
  relations panel each carried. The panel's gift line reads the effects'
  output kind through `pactAutoClicksPerSec`, which
  `collectPartnerAutoClicks` shares. The set is pinned in `effects.test.ts`
  like the dynamic set.
- **The sweep is `sweepPactWindows`** in `pacts.ts`, beside `openPactWindows`
  and called by the tick after `sweepDebuffWindows` / `sweepCooldowns`.
- **The gift rate is resolved once per tick, before either clock moves**, in
  `syncPactBonuses`, and cached as `MatchPlayer.incomingAutoClicksPerSec`.
  Read mid-tick, after one player's income had advanced their clock, the
  closing tick paid the two sides a different number of ticks for identical
  windows.
- **The enemy's open window also shows on the viewer's own active card**
  (labelled "Enemy's treaty active for Ns", with the gift line) when both
  players have signed the pact; the shared section still skips pacts the
  viewer signed, so there is no duplicate card.
- **The editor refuses a kind switch that strands an effect**: `setPactKind`
  returns a `MutationResult` and declines while the pact carries an effect
  the new kind cannot host (`partnerAutoClick` on a switch to passive),
  instead of writing a tree the boot validator rejects.
- The pact-by-id map is cached per mode definition (WeakMap, as `flavor.ts`
  does), and the opponent view computes `sharedPactWindows` once per viewer.
- The opening side of the prediction gap in §4 (clicks between the activation
  and the next snapshot predicted without the ×2) stands as accepted; it only
  ever corrects upward. Two follow-ups close the rest of it:
  - **Clicks in the activation's own batch are paid the ×2.** Clicks read the
    bonuses cached by the last tick, so the server re-runs `syncPactBonuses`
    right after a successful `activate_pact`.
  - **The close side corrects upward too.** The client stopped seeing the
    window close until the next snapshot, so it over-predicted the last
    clicks and the snapshot took score back. `externalModifiers` now drops a
    window's bonus once the snapshot's `gameSec`, advanced by real time, is
    within `PACT_CLOSE_MARGIN_SEC` (0.5 s: a batch plus a round trip) of every
    open window of that pact closing.

The buildable cut of [44 — active pacts](44-active-pacts.md), on top of
[47 — attack cooldown](47-attack-cooldown.md) (whose `PlayerState.cooldowns`
was shaped for this) and [42 — passive pacts](42-passive-pacts.md) (the
resolver module, the relations panel). 44's lifecycle and consent answers are
kept; its example pacts (Ceasefire, Trade fair) are replaced by the one
example this cut ships with:

> **Drum Accord** — your clicks are worth ×2 for 15s, but for the same 15s the
> enemy gets 3 automatic clicks per second.

A pact with a price paid _in the enemy's favour_: the signer trades a burst
of their own clicking against a gift to the other side, and has to judge
whether they out-click the gift.

---

## Goal

Make `kind: 'active'` pacts do something. An active pact is **activated** for
an `activationCost`; its effects are in force for `durationSec` game seconds;
then it rests for `cooldownSec` before it can be activated again. The same
shape as an active attack with the strike removed:

```text
locked ──unlockPact──▶ ready ──activate_pact (pay)──▶ active (durationSec) ──▶ cooling (cooldownSec) ──▶ ready
```

No preparation delay: the window opens on the activating tick, so — unlike an
attack strike — the client **predicts** it.

Two new effects make the example work:

- **`pactProductionModifier`** — a flat buff to the signer (e.g.
  `clickIncome ×2`) while the pact is in force. 44 designed it; this plan
  builds it.
- **`partnerAutoClick`** — the **new** effect: while the pact is in force, the
  _partner_ is credited `clicksPerSec` automatic clicks per second, each worth
  the partner's own click income.

---

## Decisions

| Question                                     | Decision                                                                                                                                                             | Why                                                                                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent                                      | **Unilateral** — the signer activates; the partner is affected with no say.                                                                                          | 44's recommendation. No new client→server round trip, no pending state, no bot acceptance policy.                                                                                                  |
| Preparation delay                            | None.                                                                                                                                                                | 44. The cooldown already gives the pacing a delay would.                                                                                                                                           |
| Cooldown start                               | At the window close — stamped **at activation** as `gameSec + durationSec + cooldownSec`.                                                                            | Same rule as attacks (plan 47); the window length is known at activation.                                                                                                                          |
| Cooldown storage                             | `PlayerState.cooldowns` with `kind: 'pact'`.                                                                                                                         | Built for this in plan 47.                                                                                                                                                                         |
| How the downside reaches the enemy           | Its own **partner-directed** effect (`partnerAutoClick`), not `mutual`.                                                                                              | `mutual` means "the partner gets the _same_ buff". Here the partner gets a _different_ thing; a separate output kind keeps the resolvers honest.                                                   |
| `partnerAutoClick` on a `mutual` pact        | **Rejected at boot.**                                                                                                                                                | Would the auto-clicks then flow both ways? Ambiguous — forbid it until a pact wants it.                                                                                                            |
| Auto-click value                             | `clicksPerSec × partner's click income`, the income a real click of theirs would earn right now (their modifiers, the signer's debuffs on them, their pact bonuses). | "Clicks" should mean clicks: an upgraded clicker gets more from the gift, as they would from their own finger.                                                                                     |
| Auto-click resource                          | **What the partner clicks on** — the resource of their most recent click (the server tracks it per player), their score resource until they have clicked.            | Decided. The click target is chosen client-side (click card, or the Space hotkey's cycled target); the server sees it on every click, so the last one is the best reading of "what they click on". |
| Auto-clicks need the partner's click unlock? | **Yes** — a partner who has not unlocked clicking gets nothing.                                                                                                      | Decided. The window still opens and the signer still gets the ×2; the gift simply has no one to click for.                                                                                         |
| Auto-clicks count as clicks?                 | **No** — not in `peakCps`, `totalClicks`, or the click rate limit.                                                                                                   | Espionage (peak CPS) and end-of-round stats describe the player, not a gift.                                                                                                                       |
| Mirror effects on active pacts               | Allowed (re-add the `activePact` host to `mirrorCostModifier` / `mirrorStatModifier`).                                                                               | Once windows are in `pactsInForce` they work for free; 44 step 3.                                                                                                                                  |
| Pact stats (`pactStat`)                      | Out of scope.                                                                                                                                                        | 44 open question 4 — wait for a tree branch that wants them.                                                                                                                                       |

---

## Approach

### 1. Data — `PactDefinition` active fields

[types.ts `PactDefinition`](../../shared/src/types.ts#L209):

```ts
/** Paid at activation, evaluated at level 0 like `prepareCost`. Active pacts with effects: required. */
readonly activationCost?: Readonly<Record<string, CostEntry>>
/** Game seconds the pact stays in force after activation. Active pacts with effects: required. */
readonly durationSec?: number
/** Plan 47's rest, after the window closes. Active pacts only; optional. */
readonly cooldownSec?: number
```

[tree/schema.ts `PactSchema`](../../shared/src/tree/schema.ts#L113): the three
fields, `durationSec` / `cooldownSec` `.positive()`. No tree version bump
(optional fields, as `durationSec` / `cooldownSec` on attacks).

Boot rules ([modes/index.ts](../../shared/src/modes/index.ts), beside the
attack cost/timing loop):

- active pact with effects → `activationCost` and `durationSec` required;
- passive pact declaring any of the three → throw ("always-on, never
  activated");
- `activationCost` currencies must be real resources;
- non-positive `durationSec` / `cooldownSec` → throw (programmatic modes);
- `partnerAutoClick` on a `mutual` pact → throw.

### 2. State and action

```ts
// types.ts — the predicted twin of ActiveDebuff
export interface ActivePact {
  readonly pact: string
  /** The signer's `meta.gameSec` at which the window closes. */
  readonly expiresAtSec: number
}
// PlayerState
activePacts?: ActivePact[] // absent when none; predicted client-side

// PlayerAction.type gains 'activate_pact'; the action carries `pactId`
// BotAction gains { type: 'activate_pact'; pactId: string }
```

### 3. Shared rules — `pacts.ts`

The attack functions, renamed:

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
export function getPactActivationCost(def): Record<string, number> // scaledCost(entry, 0)
export function activePactExpiresAtSec(state, pactId): number | null // read-time, like activeDebuffExpiresAtSec
export function openPactWindows(state, gameSec): ActivePact[] // read-time filter
export function sweepPactWindows(state, gameSec): void // the tick's sweep, beside sweepDebuffWindows / sweepCooldowns
export function applyPactActivation(state, pactId, mode): void
// deduct cost, push { pact, expiresAtSec: gameSec + durationSec },
// startCooldown(state, 'pact', id, expiresAtSec + cooldownSec) when cooldownSec is set
```

**`pactsInForce`** gains two passes (after the two passive ones, same
de-duplication by id): the owner's **open** active windows, then the
partner's open **mutual** active windows. `sharedPacts` likewise lists the
partner's open mutual windows. Everything downstream of `pactsInForce` —
`collectPactCostFactors`, `collectPactBonuses`, stamping, the wire — is
unchanged: an open window is a pact in force for a while.

### 4. Effect: `pactProductionModifier` → output `pactModifier`

`shared/src/effects/seed/pact-production-modifier.ts`:

```ts
schema: z.strictObject({
  stage: z.enum(MODIFIER_STAGES),
  field: z.string(),
  value: z.number(),
}).superRefine(guardModifierValue('bonus', 'pactProductionModifier'))
hosts: ['passivePact', 'activePact']
apply: (p) => ({ kind: 'pactModifier', stage: p.stage, field: p.field, value: p.value })
```

- `field` from the pact target catalog (resource rates, `clickIncome`,
  `highlightFactor` multiplicative-only) — the same boot check as
  `mirrorStatModifier` (`modes/index.ts` ~L649).
- `collectPactBonuses` keeps `pactModifier` outputs **verbatim** beside the
  resolved `mirrorModifier` ones, so the buff rides the existing
  `pactBonuses` wire field, is applied on the server's click path
  (`pactModifiersFor`, [match.ts:613](../../server/src/match.ts#L613)) and in
  the client's click prediction ([game.ts:1043](../../client/src/game.ts#L1043)),
  and is listed on the relations card with no new code.
- A `mutual` pact gives the partner the same buff (it already rides
  `pactsInForce`'s partner pass).

Prediction gap, accepted: the window is predicted but `pactBonuses` is
server-resolved, so clicks between the activation and the next snapshot are
predicted without the ×2 and corrected by that snapshot. One broadcast at
most; the alternative (a client-side resolver for own-window flat buffs) is a
second source of truth. (As built, the close side is handled too — see Status.)

### 5. Effect: `partnerAutoClick` → output `partnerAutoClick` (new)

`shared/src/effects/seed/partner-auto-click.ts`:

```ts
schema: z.strictObject({ clicksPerSec: z.number().positive().max(MAX_AUTO_CLICKS_PER_SEC) })
hosts: ['activePact'] // a permanent auto-clicker for the enemy is not a pact anyone signs
apply: (p) => ({ kind: 'partnerAutoClick', clicksPerSec: p.clicksPerSec })
```

Partner-directed (`partnerDirected: true` on the `EffectDef`, the trait the
validator and `sharedPactWindows` read), so it is **not** in `pactsInForce`'s
owner walk. A new resolver:

```ts
/**
 * Automatic clicks per second `signer`'s open active pacts grant their partner.
 * Summed across windows (two pacts stack). Resolved server-side only.
 */
export function collectPartnerAutoClicks(signer: Readonly<PlayerState>, mode): number
```

**Server tick** ([match.ts `applyPassiveIncome`](../../server/src/match.ts#L618)
or a sibling called beside it): for each player,
`rate = collectPartnerAutoClicks(opponent.state, mode)` — resolved in
`syncPactBonuses` before either player's income moves and cached on
`MatchPlayer`, so both sides are judged on the same instant; when `rate > 0`
**and `isClickUnlocked(player.state, mode)`**, credit `rate × tickSec × clickIncome`
to the player's **click target** via `creditResource`, where `clickIncome` is computed from exactly the modifier
list `applyClick` builds (own + resolved enemy debuffs + pact modifiers).
Extract that list into one private helper so the two paths can't drift. No
`peakCps` / `totalClicks` / rate-limit bookkeeping.

**Click target:** `MatchPlayer.lastClickResource`, written by `applyClick`
with the resource it credited (after the same fallback: an unknown or absent
resource is the score resource). Unset until the first click, when the
auto-clicks go to the score resource. Server-only — the client already knows
where it clicks.

`clicksEnabled: false` modes: the boot rule rejects `partnerAutoClick` there
(no click income to credit).

### 6. Server wiring

- `processActions` / `processBotActions`: an `activate_pact` branch →
  `isValidPactActivation` → `applyPactActivation`, beside the attack branch.
- `resolveDueAttacks` calls `sweepPactWindows` after `sweepDebuffWindows`
  and `sweepCooldowns` (which already covers pact cooldowns): drop closed
  `activePacts`, deleting the field once empty.
- `endRound`: `delete state.activePacts` beside `activeDebuffs`.
- Pact bonuses are recomputed per tick (`refreshPactBonuses`), so a window
  opening mid-tick is worth whole ticks — the same granularity as attack
  windows.

### 7. Wire and events ([messages.ts](../../shared/src/messages.ts))

- **`OpponentView.pacts`** becomes
  `{ pact: string; expiresAtSec?: number }[]` — passive mutual pacts without
  an expiry, plus the opponent's open windows that reach the viewer: mutual
  windows, and windows carrying a partner-directed effect (so the victim of
  the auto-clicks sees what is happening and for how long).
- **`STATE_UPDATE.incomingAutoClicksPerSec?: number`** — the rate the viewer
  is receiving, for the relations panel's "+3 clicks/s" line (the credited
  income itself arrives in `resources` like any other income).
- **`PactEvent`** `{ pact, direction: 'own' | 'partner', durationSec }`
  buffered on `MatchPlayer.pactEvents` and drained with the broadcast, like
  `attackEvents`. Emitted at activation to the signer (`own`) and — when the
  pact reaches the partner (mutual or partner-directed) — to the partner.

### 8. Client

- **`doActivatePact(pactId)`** — `pactBlockReason` → optimistic
  `applyPactActivation` → `queueAction({ type: 'activate_pact', pactId })` →
  `trackPredicted`; the reconcile replay gets an `activate_pact` case beside
  `activate_attack` ([game.ts:819](../../client/src/game.ts#L819)).
- **`clonePlayerState`** carries `activePacts` (predicted, replayed).
- **Relations panel**
  ([international-relationship-panel.ts](../../client/src/ui/panels/international-relationship-panel.ts)):
  `renderActiveSection` stops being a disabled placeholder. Each card is the
  attack card's five states — price (with shortfall), "Active for Ns" +
  worth lines from `pactBonuses`, "Ready in Ns", blocked — and a click calls
  `doActivatePact`. The shared section lists the opponent's windows reaching
  the viewer, with their countdown and, for auto-clicks, the
  `incomingAutoClicksPerSec` line. A pact the viewer has also signed gets no
  shared card; the enemy's open window shows under the status of the viewer's
  own card instead, labelled as theirs.
- **Toasts:** own — `🥁 Drum Accord signed — clicks ×2 for 15s`; partner —
  `🥁 Enemy signed Drum Accord — you get 3 clicks/s for 15s`. `success` /
  `info` variants.

### 9. Bot

**Not in this cut** (decided). The bot never activates a pact; `BotAction`
still gains `activate_pact` so the server's bot branch mirrors the player
branch, but nothing emits it. A later `firePact` beside `fireAttack`
([bot.ts:380](../../server/src/bot.ts#L380)) can sign plain pacts from surplus;
Drum Accord would need the bot to model its own clicking against the gift.

### 10. Editor

- Pact row: activation cost (currency rows, as the attack prepare cost),
  duration and cooldown inputs behind the kind select; cleared on a switch to
  passive. The switch is refused (status line, select put back) while the
  pact carries an effect the new kind cannot host, e.g. `partnerAutoClick`
  going passive — the validator would reject the saved tree.
- Both new effects join the "Pacts" picker group; the pact target catalog
  feeds `pactProductionModifier.field`.

### 11. Content — Drum Accord

`shared/trees/idler.json` (and `idler-alternative.json`):

```json
{
  "id": "drum-accord",
  "kind": "active",
  "activationCost": { "r0": { "baseCost": 300 } },
  "durationSec": 15,
  "cooldownSec": 45,
  "effects": [
    {
      "type": "pactProductionModifier",
      "stage": "multiplicative",
      "field": "clickIncome",
      "value": 2
    },
    { "type": "partnerAutoClick", "clicksPerSec": 3 }
  ]
}
```

Flavor: `🥁 Drum Accord` — "Your clicks are worth ×2 for 15s — but the enemy
gets 3 automatic clicks per second for as long." An unlock node
(`unlockPact: drum-accord`) under `ir-unlock`. Numbers are placeholders.

---

## Tests

**shared**

- `pacts.test.ts`:
  - `pactBlockReason` order (`unknown` → `not-active` → `locked` →
    `no-effects` → `already-active` → `cooling-down` → `unaffordable`);
  - `applyPactActivation` deducts, opens the window, stamps the cooldown at
    `expiresAtSec + cooldownSec`;
  - `pactsInForce` includes own open windows and partner open mutual windows,
    excludes closed windows and partner one-sided windows, lists a pact once;
  - `collectPactBonuses` keeps a `pactModifier` verbatim, alongside mirrors;
  - `collectPartnerAutoClicks` sums open windows, ignores closed ones;
  - `sweepPactWindows` drops closed windows, deletes the field once empty;
  - a test-registered gift effect flagged `partnerDirected` is revealed by
    `sharedPactWindows` and rejected on a mutual pact — the trait, not the
    name, decides.
- `effects.test.ts`: both schemas (positive `clicksPerSec`, bonus-direction
  guard on the modifier); the partner-directed set is pinned.
- `flavor.test.ts` (validation): active pact without cost / duration throws;
  passive pact with any timing field throws; unknown activation currency
  throws; `partnerAutoClick` on a mutual pact, on a passive pact, and in a
  clicks-disabled mode throws; `pactProductionModifier` field catalog.
- `tree.test.ts`: `PactSchema` accepts the active fields, rejects
  non-positive durations.

**server** (`match.test.ts`, `bot.test.ts`)

- `activate_pact` validated and applied; refused while active, while cooling
  (even when affordable), and when unaffordable.
- Drum Accord: the signer's click credits ×2 inside the window and ×1 after;
  the partner is credited `3 × tickSec × theirClickIncome` per tick inside
  the window, to the resource of their last click (score resource before any
  click), and nothing after; nothing at all while they have not unlocked
  clicking; the partner's `peakCps` / `totalClicks` do
  not move; the window freezes with a pause; `endRound` clears it; two
  identical windows opened in the same instant pay both sides the same.
- Events: `own` to the signer, `partner` to the partner, once each.
- Opponent view: the partner sees the window with its expiry; a one-sided,
  own-only window never reaches the partner.
- The bot never activates a pact.

**client**

- `game.test.ts`: `doActivatePact` predicts (cost deducted, window open,
  action queued), refuses while cooling; the replay keeps / drops it against
  the snapshot.
- Relations panel: the five card states; the shared section's countdown and
  clicks/s line; the enemy's window on the viewer's own card when both signed.
- Toasts once per event.
- Editor model: pact fields set / clear / stripped on passive; a switch that
  would strand an active-only effect is refused and leaves the tree as it was.

---

## Implementation order

1. `feat(pacts): active pact fields, activePacts, activate_pact` — §1, §2,
   §3 (minus `pactsInForce`), §6 action branches + sweep + round end, client
   prediction (§8 first two bullets), boot rules.
2. `feat(pacts): open windows are in force` — `pactsInForce` / `sharedPacts`
   passes; re-add the `activePact` host to the mirror effects.
3. `feat(pacts): pactProductionModifier`.
4. `feat(pacts): partnerAutoClick` — effect, resolver, server tick credit.
5. `feat(net): pact events, opponent pact expiry, incoming auto-click rate`.
6. `feat(client): activate pacts from the relations panel, toasts`.
7. `feat(editor): active pact fields and effects`.
8. `feat(idler): Drum Accord`.

---

## Decided (were open questions)

1. **Partner without clicking** — gets no auto-clicks.
2. **Auto-click resource** — what the partner clicks on (their last click's
   resource; score resource before any click).
3. **Signer sees the gift's worth** — no; the signer sees only the rate their
   pact grants.
4. **Bot** — does not sign pacts in this cut.

## Open questions

1. **Pact slots** (the `attackSlots` twin) — still no need.
