# 21 — Show incoming enemy debuffs in the victim's own rate display

## The bug

- Player 1 produces 10 wood/s. Player 2 has an unlocked **passive attack** that
  inflicts an `enemyProductionModifier` (e.g. −10% wood).
- Player 2's **espionage** panel correctly shows player 1 at **9 wood/s**.
- Player 1's own header still shows **10 wood/s** — but their resources are
  actually accumulating at 9/s.

So the header is lying: the displayed rate disagrees with the real (debuffed)
production the server is applying.

## Root cause

The debuff is applied on the **server** in two places, both correct:

- Real production — [`Match.applyPassiveIncome`](../../server/src/match.ts) merges
  `collectModifiers(player.state)` with `collectEnemyDebuffs(opponent.state)`
  before `applyPassiveTick`. Player 1 genuinely ticks at 9/s.
- Espionage view — [`Match.opponentViewFor`](../../server/src/match.ts) merges
  `collectModifiers(opponent.state)` with `collectEnemyDebuffs(viewer.state)`
  when computing `view.rates`. Player 2 correctly spies 9/s.

But the **victim's own displayed rate** is recomputed **client-side** in
[`passiveRates`](../../client/src/ui/playing.ts) (`playing.ts:47`):

```ts
computePassiveRates(collectModifiers(state.player, activeModeDef), activeModeDef.resources)
```

This uses only the player's own modifiers. The client never receives the
opponent's state (it's redacted), so it cannot compute
`collectEnemyDebuffs(opponent)` — the incoming debuff is invisible to it. Hence
the header shows the _undebuffed_ 10/s.

Note: passive income itself is **not** predicted on the client — it comes
entirely from the server snapshot (`reconcile` only re-applies optimistic
clicks/purchases). So only the _rate label_ is wrong; the resource totals are
right.

## Fix

Send the incoming debuff modifiers to the victim so the client can display the
true effective rate. Minimal, consistent with the existing "server computes,
client displays" pattern used for espionage rates.

### Changes

1. **`shared/src/messages.ts`** — add an optional field to `StateUpdateMessage`:

   ```ts
   /** Offensive modifiers the opponent's passive attacks currently inflict on
    *  the receiving player. Empty/omitted when none. Lets the client render the
    *  player's true (debuffed) production rate, matching server-side income. */
   debuffs?: Modifier[]
   ```

   (`Modifier` is already exported from shared.)

2. **`server/src/match.ts`** — in `broadcastState`, compute
   `collectEnemyDebuffs(opponentState, modeDef)` **once per player** (not twice)
   and include it as `debuffs` on each `STATE_UPDATE`. Omit (or send `[]`) when
   there are none.

3. **`client/src/ui/playing.ts`** — `passiveRates` merges the server-sent
   debuffs into the modifier list before `computePassiveRates`:

   ```ts
   computePassiveRates(
     [...collectModifiers(state.player, activeModeDef), ...(state.debuffs ?? [])],
     activeModeDef.resources,
   )
   ```

4. **`client/src/game.ts`** — add `debuffs: Modifier[]` to the `GameState` shape,
   default it to `[]` in the initial state, set `state.debuffs = msg.debuffs ?? []`
   in `handleStateUpdate`, and **reset it to `[]` on round start / new match**
   (alongside `opponentPurchaseFeed`) so a debuff from a previous round can't
   linger on the header. Client reads must tolerate the omitted case (`?? []`).

### Scope notes

- The only client-side display that recomputes the player's own passive rate is
  the header resource bar (`playing.ts:47`); no generator-panel changes needed.
  (The generators panel shows each generator's raw base rate `production.rate ×
owned` — it already ignores _all_ pipeline modifiers, so debuffs are correctly
  out of scope there.)
- Debuffs are applied verbatim (no owned-count compounding), matching
  `collectEnemyDebuffs`.

### Why this is complete (invariant to preserve)

Offensive debuffs can only target the set returned by `enemyDebuffTargetsFor`
(`shared/src/effects/addressable.ts`): **resource rates + `globalMultiplier`**.
That is exactly the set `computePassiveRates` consumes — `clickIncome` and
generator-id targets are deliberately excluded there because they'd be inert on
the passive-income path. So merging debuffs into the passive-rate computation
closes the gap with **no leftover debuffable dimension** the header could still
misreport. **If the debuff catalog is ever widened (e.g. to allow debuffing
`clickIncome`), the corresponding client display must be revisited too.**

### Non-issues confirmed during review (do not "fix")

- **Click income**: `applyClick` uses only `collectModifiers(player)` with no
  debuffs — but debuffs can't target `clickIncome`, so server clicks and the
  client's `computeClickIncome` already agree. Consistent by design.
- **Redaction tradeoff**: sending raw `Modifier[]` exposes each debuff's
  `field`/`value` to the victim's client. This is intentional — they're the
  victim's _own_ resource fields (not opponent state), and sending pre-debuffed
  effective rates instead would flicker on optimistic purchases (the header must
  reflect predicted buys instantly). `Modifier` is pure serializable data, so
  it's wire-safe. Staleness is ≤1 tick, same as the opponent view.

## Tests

- **server**: `broadcastState` includes `debuffs` reflecting the opponent's
  unlocked passive attacks (and is empty/absent when the opponent has none).
  Extend the existing match/espionage tests. **Watch for `toEqual` on the whole
  `STATE_UPDATE` message** — a new top-level field can break a full-object
  assertion; current tests assert sub-fields, so likely safe, but run the suite.
- **client**: `passiveRates` (or a small extracted helper) applies incoming
  debuffs so the header rate matches the debuffed figure; and the field resets
  between rounds.
- Full `pnpm typecheck` + both test suites before marking ready.
