# 53 — Data panel: attacks and pacts

## Status: Implemented

As built, with these departures from the text below (first drafted as plan 51,
a number since taken by tree visibility modes):

- **Strikes are counted per landing, not per event.** One strike can send
  several `attackEvents` (a theft plus a debuff window), so a strike is a new
  `t` for its attack; misses are counted beside it.
- **Pact telemetry reads the server snapshot**, `msg.player`, never the
  reconciled state: a replayed optimistic activation carries a window the
  client timed, which would count as a second activation once the server's
  own window arrives.
- **Time active comes from the window bounds**, not per-tick deltas. A pact's
  `durationSec` is authored and never scaled, so a window opened at
  `expiresAtSec − durationSec`; summing `min(gameSec, end) − start` is exact,
  counts the seconds before the first snapshot that showed the window, and
  freezes with a paused clock all the same.
- **A section also shows when the opponent's side of it reaches the player**
  — a strike suffered, a debuff or purchase lock on them, an enemy treaty —
  even before the player's own tab unlocks: being hit is in play whatever the
  victim has researched.
- **No "N more locked" footer.** The tree already shows what is locked; the
  panel reports this round's numbers.
- The purchase-target wording (`describePurchaseTarget`) moved from the
  espionage panel into `ui/helpers.ts` beside the pact wording, so the
  data panel's lock rows read the same as the espionage warnings.
- Steps 3 and 4 landed as one commit: both sections share the list
  machinery (`setListHtml`, `renderItem`, slot cells).

The data panel ([data-panel.ts](../../client/src/ui/panels/data-panel.ts))
reports production, live bonuses, clicking, highlight and inventory. It says
nothing about the two systems the last plans built out — attacks
([47](47-attack-cooldown.md), [50](50-slot-cost.md)) and pacts
([48](48-active-pacts.md), [49](49-pact-limit.md)). This plan adds a section
for each, in the panel's existing idiom: a collapsible `renderSection` card,
a skeleton rendered once per round, numbers pushed by `update()`, per-round
telemetry in [round-stats.ts](../../client/src/stats/round-stats.ts).

---

## Goal

Two new sections, each shown only once its system is in play (the panel tab
of that system is unlocked, or the player holds something of it):

### ⚔️ Attacks

| Block           | Rows                                                                                                                                                                                             | Source                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slots           | `Active 2 / 3`, `Passive 1 / 4` (weighted, per capped kind)                                                                                                                                      | `attackSlotsHeld` / `attackLimit`                                                                                                                       |
| Per held attack | status (ready / preparing / active / cooling, with seconds); strikes landed; stolen per resource; generators stolen; debuff time inflicted; resolved stats (prep, window, cooldown, power, cost) | state (`pendingAttacks`, `activeDebuffs`, `cooldowns`); `roundStats` fed by outgoing `attackEvents`; `collectAttackParams` + the `getAttack*` resolvers |
| Incoming        | strikes suffered; lost per resource; generators lost; debuffs on me now (field + value); purchase locks now, with seconds                                                                        | `meta.attacksSuffered`; `roundStats` fed by incoming `attackEvents`; `GameState.debuffs`; `incomingPurchaseLocks`                                       |

### 🤝 Pacts

| Block             | Rows                                                                                                                                                                     | Source                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Slots             | `Active 1 / 1`, `Passive 2 / 2`                                                                                                                                          | `pactSlotsHeld` / `pactLimit`                                      |
| Per held pact     | status (ready / active / cooling); worth now (from `pactBonuses`); discount lines (from `pactCostFactors`); times activated; total seconds active; activation cost spent | state; `roundStats` fed by `activePacts` transitions in snapshots  |
| Shared / incoming | enemy treaties reaching me, with countdowns; auto-clicks received per second now                                                                                         | `opponentPacts`, `opponentPactWindows`, `incomingAutoClicksPerSec` |

---

## Decisions

| Question                                    | Decision                                                                                                                                               | Why                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| What counts an attack "activation"?         | **Landed strikes** from the server's outgoing `attackEvents`, not optimistic `doActivateAttack` calls.                                                 | A predicted activation can be dropped on reconcile; an event is sent exactly once per landed strike.      |
| What counts a pact activation?              | A **new** `activePacts` window (new `expiresAtSec`) in a reconciled snapshot.                                                                          | No pact event exists (plan 48 reuses `opponent.pacts`); the window list is authoritative after reconcile. |
| Where telemetry lives                       | `RoundStats` grows `attacks` and `pacts` blocks, reset per round, fed from `handleStateUpdate`.                                                        | The module's stated purpose: one self-contained place for round telemetry.                                |
| Section visibility                          | Attacks: when the attack panel is unlocked. Pacts: when the relations panel is unlocked. Hidden (not empty) before.                                    | Matches how the panel tabs gate themselves; the battery block's `hidden` pattern does the flip mid-round. |
| Per-attack rows: every attack or held only? | **Held only**, plus a one-line "N more locked" footer.                                                                                                 | The panel is about this round's numbers; locked attacks have none.                                        |
| Re-render strategy                          | Stable skeleton for fixed rows (slots, incoming totals); the per-item lists re-rendered wholesale when their HTML changes, like the live-bonuses list. | Items appear mid-round (a new unlock); the bonuses list already solves exactly that.                      |

---

## Approach

1. **Telemetry** — `round-stats.ts`:
   - `recordAttackEvents(events)`: per attack id — strikes, stolen per
     resource, generators stolen, debuff seconds; incoming — lost per
     resource, generators lost.
   - `recordPactWindows(prev, next)`: per pact — activations, and seconds
     active accumulated from game-second deltas while a window is open (same
     technique as highlight dwell).
   - Accessors returning read-only snapshots; `reset()` clears both.
   - Fed from `handleStateUpdate` in [game.ts](../../client/src/game.ts)
     beside `roundStats.recordTick`.
2. **Attacks section** — `renderAttacksSection` in the skeleton; `updateAttacks`
   in `update()`. Status text reuses the attack card's countdown helpers
   (`countdownSpan`), stats reuse the resolvers.
3. **Pacts section** — same shape; worth / discount lines extracted from the
   relations panel into a small shared formatter so the two panels cannot
   drift (`worthLine`, `discountLines`).
4. **CSS** — reuse `.data-stat*` classes; one `.data-item` row style for the
   per-item lists.

---

## Tests

- `round-stats.test.ts` — attack events accumulate per attack and direction;
  a repeated snapshot does not double-count a pact window; seconds active
  accumulate only while open and freeze on pause; `reset()` clears.
- `data-panel.dom.test.ts` — sections hidden before their panel unlocks;
  slots rows weighted; per-attack status and stolen totals; incoming debuff
  rows; pact worth and activation count; shared treaty countdown and
  auto-click rate.

---

## Implementation order

1. `docs(plans): 51 — data panel attacks and pacts`
2. `feat(stats): attack and pact round telemetry` — §1.
3. `feat(data-panel): attacks section` — §2.
4. `refactor(relations): share pact worth formatting` + `feat(data-panel): pacts section` — §3.

---

## Open questions

1. **Income from the enemy's auto-clicks** — the client sees the rate, not the
   credited total (it arrives mixed into `resources`). Showing "earned from
   gifts" needs the server to ship a running total
   (`STATE_UPDATE.autoClickIncome`?). Not planned until asked.
2. **Money saved by pact discounts** — computable client-side at purchase time
   (authored price − paid price), but only for purchases the client predicted;
   a server total would be exact. Same deferral.
3. **Signer's view of the gift** — plan 48 decided the signer does not see
   what the gift is worth; this panel keeps that (shows the rate granted only).
4. **Enemy stats beyond espionage** — every row here is the player's own data
   or already on the wire; nothing new is revealed.
