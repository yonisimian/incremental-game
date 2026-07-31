# 26 — Sell generators (50% refund)

## Status: Draft

---

## Goal

Let a player sell one copy of a generator and get **50% of that copy's cost**
back into the currency it was bought with. One button per generator card, placed
**under** the existing `Buy 1` / `Buy ×N` row. Bulk selling ("sell all", "sell
×10") is explicitly **out of scope** for this plan but the shared helpers are
shaped so it can be added later without touching the wire protocol.

Why: generator investment is currently irreversible. A player who over-invests in
`g0` is stuck with it for the round. A refundable-at-a-loss sell adds a real
mid-round decision (pivot tiers, dump a producer to fund a key upgrade) while the
50% haircut keeps it from being free.

---

## Design decisions

1. **Refund = `floor(0.5 × cost of the copy being removed)`.**
   Selling from `owned = n` removes copy `n`, whose price is
   `getGeneratorCost(effectiveDef, n - 1)` — i.e. exactly what the next re-buy
   will cost. Refund rate lives in [game-config.ts](../../shared/src/game-config.ts)
   as `GENERATOR_SELL_REFUND_RATE = 0.5`.
2. **Priced with the _current_ cost-adjusted definition** (`resolveGeneratorDef`),
   not the historical price paid. State stores only owned counts, so there is no
   purchase history to price against — and pricing against the current curve keeps
   `sell → re-buy` a clean −50% round trip. See the exploit analysis below for why
   this is safe given today's `generatorCost` data.
3. **Refund credits resources, never `score`.** `score` is total score-resource
   _earned_; a refund is not earnings. `applyGeneratorPurchase` already mutates
   `state.resources` only, and the sell mutator must mirror that. **If a refund
   ever incremented `score`, buy→sell cycling would become an infinite score
   farm** — this is the single most important invariant in this plan.
4. **Both sides floor.** Cost is floored (`getGeneratorCost`) and the refund is
   floored again, so a refund can never exceed what the copy costs to re-buy, and
   client/server agree bit-for-bit with no float drift.
5. **Sells are always instant and never "unaffordable"** — the only failure modes
   are "no such generator" and "owns none".
6. **No unlock check on sell.** Generator unlocks are monotonic (`generatorUnlock`
   effects, never revoked), so `owned ≥ 1` already implies it was unlocked. Adding
   an unlock check would only create a way to strand resources.
7. **Sells are not written to the espionage purchase log.** That log is a
   purchase feed with a `kind: 'upgrade' | 'generator'` discriminant consumed by
   [`opponentViewFor`](../../server/src/match.ts) redaction; adding a third kind is
   a wire + UI change with no gameplay need yet. Consequence: an opponent watching
   the feed sees the buy but not the sell, and can infer a stale generator count.
   Acceptable for v1 — noted under follow-ups.

---

## Shared layer

### [shared/src/game-config.ts](../../shared/src/game-config.ts)

```ts
/** Fraction of a generator copy's cost refunded when it is sold. */
export const GENERATOR_SELL_REFUND_RATE = 0.5
```

### [shared/src/generators.ts](../../shared/src/generators.ts)

Three additions, alongside the existing buy helpers:

```ts
/**
 * Refund for selling one copy, given the *cost-adjusted* definition. Prices the
 * copy being removed (index `owned - 1`) — the same price a re-buy will charge.
 * 0 when nothing is owned.
 */
export function getGeneratorSellRefund(def: GeneratorDefinition, owned: number): number {
  if (owned <= 0) return 0
  return Math.floor(getGeneratorCost(def, owned - 1) * GENERATOR_SELL_REFUND_RATE)
}

/** Can the player sell a copy of this generator right now? */
export function canSellGenerator(state: Readonly<PlayerState>, def: GeneratorDefinition): boolean {
  return (state.generators[def.id] ?? 0) > 0
}

/**
 * Decrement the owned count and credit the refund. Mirrors
 * `applyGeneratorPurchase`: resolves cost factors itself, mutates
 * `state.resources` only — never `state.score`.
 */
export function applyGeneratorSell(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): void
```

`applyGeneratorSell` follows `applyGeneratorPurchase` line for line: find the def
(no-op if unknown), `resolveGeneratorDef`, read `owned` (no-op if `0`), compute
the refund, `state.resources[currency] += refund`, `state.generators[id] = owned - 1`.

A future bulk sell adds `getGeneratorBulkRefund(def, owned, quantity)` next to
`getGeneratorBulkCost` and loops the mutator — no protocol change needed.

### [shared/src/purchase-validation.ts](../../shared/src/purchase-validation.ts)

```ts
/** Why a generator sale is disallowed. Both reasons are permanent. */
export type GeneratorSellBlockReason =
  | 'unknown' // no such generator
  | 'not-owned' // owns zero copies

export function generatorSellBlockReason(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): GeneratorSellBlockReason | null

export function isValidGeneratorSell(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): boolean
```

Same `reason === null` wrapper pattern as the existing validators, so the
go/no-go answer and the reason can't drift. **Neither reason is transient** — the
simulator's `classify` treats only `'unaffordable'` as "wait and retry", so a
blocked sell must be reported as permanent, never waited on.

Both files are re-exported by `shared/src/index.ts` via `export *`, so no barrel
edit is needed.

---

## Wire protocol

[shared/src/types.ts](../../shared/src/types.ts):

```ts
export type ActionType = 'click' | 'buy' | 'buy_generator' | 'sell_generator' | 'set_highlight'
```

`PlayerAction.generatorId` is reused verbatim — its doc comment becomes
"For 'buy_generator' / 'sell_generator' actions: the generator to buy or sell."
No new field, no `ActionBatchMessage` change.

`ActionType` is a bare union with no exhaustive `switch` on it outside the
handlers listed below, so widening it is cheap. (Contrast: the _simulator's_
`SimAction` union **is** switched on exhaustively in several places — see
"Simulator support" below.)

---

## Server

[server/src/match.ts](../../server/src/match.ts) `processActions` — one new branch
next to the `buy_generator` one:

```ts
} else if (action.type === 'sell_generator' && action.generatorId) {
  if (!isValidGeneratorSell(player.state, action.generatorId, this.modeDef)) continue
  applyGeneratorSell(player.state, action.generatorId, this.modeDef)
}
```

- No `recordPurchase` call (decision 7).
- No rate limit. Sells are self-limiting: each one costs 50% of a copy, and
  `owned` bounds the count. Nothing to farm, so the click-style
  [`isValidClick`](../../server/src/validation.ts) sliding window is not needed.
- Phase gating is already handled — `processActions` only runs for the `playing`
  phase, so a sell arriving during countdown or after `endRound` is dropped by
  existing code.
- `processBotActions` is **not** extended: the bot never sells
  ([bot.ts](../../server/src/bot.ts) `BotAction` stays as-is).

[server/src/validation.ts](../../server/src/validation.ts): add
`isValidGeneratorSell` to the existing re-export line so server call sites and
tests keep importing validators from one place.

---

## Client

### Ordered optimistic replay (required refactor)

Today [`PendingBatch`](../../client/src/game.ts#L131-L139) stores prediction as
**parallel arrays** (`clicks`, `purchases`, `generatorPurchases`, `highlight`)
and `handleStateUpdate` replays them in a fixed order: clicks → purchases →
highlight → generator purchases. The server, by contrast, applies the batch in
true wire order.

Sells break that approximation, because a sell both _adds_ resources and
_changes the price_ of neighbouring buys:

> Own 5 copies. Buy one (pay `cost(5)`, owned 6), then sell one (refund
> `50% × cost(5)`, owned 5). Replaying sells before buys instead refunds
> `50% × cost(4)` and then charges `cost(5)` — a different resource total, on top
> of a possible validity flip (sell the only copy you bought this batch → the
> replayed sell is skipped, and owned/resources both end up wrong).

Any fixed replay order is wrong for some sequence, and the error persists until
the next ack (~500 ms of visibly wrong card state). So replace the parallel
arrays with an ordered log:

```ts
/** A locally-applied action, replayed in order during reconciliation. */
type PredictedAction =
  | { kind: 'click'; resource: string }
  | { kind: 'buy'; upgradeId: string }
  | { kind: 'buy_generator'; generatorId: string }
  | { kind: 'sell_generator'; generatorId: string }
  | { kind: 'set_highlight'; highlight: string }

interface PendingBatch {
  seq: number
  /** Exactly the order they were applied locally — and the order the server sees. */
  actions: PredictedAction[]
}
```

- The four `trackPending*` helpers collapse into one `trackPredicted(action)`.
- `handleStateUpdate`'s three replay loops collapse into one
  `for (const a of batch.actions) switch (a.kind) { … }`, with each arm keeping
  its **existing** guard logic verbatim (maxed / prerequisite / affordability
  checks for `buy`; `canAffordGenerator` for `buy_generator`; new `owned > 0`
  check for `sell_generator`; last-write-wins for highlight falls out of ordered
  replay for free).
- Behaviour is unchanged for any batch that contains no sells, which keeps the
  diff reviewable and lets the existing client tests act as a regression net.

This is the one non-trivial piece of the plan — do it as its own commit, before
the sell feature, so a regression is easy to bisect.

### `doSellGenerator`

[client/src/game.ts](../../client/src/game.ts), mirroring `doBuyGenerator`:

```ts
/** Attempt to sell one copy of a generator (optimistic). */
export function doSellGenerator(generatorId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  const def = modeDef.generators.find((g) => g.id === generatorId)
  if (!def) return
  if (!canSellGenerator(state.player, def)) return
  applyGeneratorSell(state.player, generatorId, modeDef)
  queueAction({ type: 'sell_generator', timestamp: Date.now(), generatorId })
  trackPredicted({ kind: 'sell_generator', generatorId })
  notify()
}
```

No VFX (generator buys have none either — `flashPurchase`/`shakeScreen` are
upgrade-only). No `doSellGeneratorMax`.

### Card UI

[client/src/ui/panels/generators-panel.ts](../../client/src/ui/panels/generators-panel.ts):

1. `GeneratorCardNums` gains `readonly sellRefund: number` (0 when `owned === 0`).
2. `renderGeneratorCardView` emits a second action row under the buy row:

```html
<div class="generator-actions">
  <button data-action="buy" …>Buy 1 — 💰10</button>
  <button data-action="buy-max" …>Buy ×4 — 💰49</button>
</div>
<div class="generator-actions">
  <button class="generator-buy-btn sell" data-action="sell" ${owned <= 0 ? 'disabled' : ''}>
    Sell 1 — +💰5
  </button>
</div>
```

With `owned === 0` the button is disabled and reads `Sell 1 — —` (matching how
`buy-max` renders its unavailable state). The button keeps the
`generator-buy-btn` class so the existing delegated click handler and disabled
styling apply unchanged; the `sell` modifier class carries the distinct look. 3. `renderAllGenerators` computes `sellRefund` from the already-resolved
`effectiveDef` and `owned` — `getGeneratorSellRefund(effectiveDef, owned)`, no
extra `resolveGeneratorDef` call. 4. `bind()` grows one branch: `data-action === 'sell'` → `doSellGenerator(gid)`.
The handler already reads `data-action`, so it's a third case in the same `if`
chain.

Because the card HTML is diffed as a string (`prevHtml`), the refund figure
updates automatically on every state change.

### CSS

[client/src/style.css](../../client/src/style.css) next to `.generator-buy-btn.buy-max`
(~line 1565): a `.generator-buy-btn.sell` rule — muted/danger tint
(`var(--danger)` border-hover, transparent background) so selling never reads as
the primary action, plus a small `margin-top` on the second `.generator-actions`
row (or make the two rows a `flex-wrap` container — either is fine, keep it to
one added rule set).

### Dev editor preview

[client/src/dev/editor/views/generators.ts](../../client/src/dev/editor/views/generators.ts)
calls `renderGeneratorCardView` with a hand-built `GeneratorCardNums`, so the new
field must be supplied there too (a plausible constant is fine — the preview is
non-interactive). Mirror the new button's styling in
[client/src/dev/dev.css](../../client/src/dev/dev.css) beside the existing
`.ed-gen-preview-body .generator-buy-btn.buy-max` rule.

---

## Exploit / invariant analysis

- **Score can never be gained by selling** (decision 3). This is the load-bearing
  invariant; it gets a dedicated test.
- **Refund ≤ re-buy price**, because both are floored from the same
  `getGeneratorCost(def, owned - 1)` with a rate < 1. So `sell → buy` is always a
  strict resource loss and cannot cycle for profit.
- **Cost-reduction upgrades are safe in the direction they're authored.** A
  `generatorCost` effect with `costFactor < 1` lowers the curve, so a copy bought
  before the reduction refunds _less_ than 50% of what was paid — a loss, not an
  exploit. ⚠️ The effect's
  [schema](../../shared/src/effects/seed/generator-cost.ts) only requires
  `positive()`, so a hypothetical `costFactor > 1` (cost _increase_) upgrade would
  let a player buy cheap, take the increase, and sell above 50% of the price paid.
  No such data exists in [idler.json](../../shared/trees/idler.json) today.
  **If cost-increasing `generatorCost` data is ever authored, revisit the refund
  pricing rule** (the alternative is storing a per-generator paid-cost basis in
  `PlayerState`, which is a wire + state change — deliberately not done now).
- **Count-reading effects already tolerate counts going down.**
  `balancedGenerators`, `dominantGenerator` and `lowerTierBoost` are pure
  functions of the current `state.generators` map and each handle the all-zero
  case (`total <= 0` / `max <= 0` early returns). No monotonicity assumption to
  break, no divide-by-zero on the way down.
- **Nothing gates on generator counts.** `prerequisites.ts` conditions are
  upgrade/resource based and `unlock-gates.ts` gates generators _by upgrades_, so
  selling can never revoke an unlock, close a panel, or un-buy an upgrade.
- **Balance shift to watch:** with sells available, a player can sculpt their
  ownership spread to farm `balancedGenerators` (sell down the leader to raise
  `balanceRatio`) or to re-point `dominantGenerator` onto a generator with better
  multipliers. The 50% haircut is the only brake. This is exactly why the
  simulator gets sell support in the same plan (next section) — otherwise the
  envelope gate could never see the strategy. Worth a manual look at
  [docs/BALANCE.md](../BALANCE.md) numbers after shipping.

---

## Simulator support (`sell_generator` SimAction)

In scope for this plan. Without it the headless strategy simulator, the balance
envelope gate, and the dev Queue-Sim tab all pretend selling doesn't exist — and
[`liveActionsToStrategy`](../../shared/src/simulation/live-export.ts) **silently
drops** action types it doesn't know, so exporting a round in which the player
sold anything would produce a strategy that keeps the generators and skips the
refunds. That's a mystery divergence waiting to happen.

**Naming:** the sim kind is `sell_generator`, matching the existing snake_case
`buy_generator` (and the wire `ActionType`), not `sellGenerator`.

**No `count` field in v1.** A sim sell is one unit, mirroring the `Sell 1`-only
UI. `count` is an optional field, so adding it later (together with the deferred
bulk-sell UI) is a backward-compatible schema change and needs no version bump.

### [strategy.ts](../../shared/src/simulation/strategy.ts)

- `SimActionSchema`: new member
  `z.strictObject({ kind: z.literal('sell_generator'), generatorId: z.string() })`.
  `QueueStrategySchema.version` stays `1` — old files still parse; only new files
  containing sells fail on older builds, which is the normal forward direction.
- Export `SellGeneratorAction = Extract<SimAction, { kind: 'sell_generator' }>`
  next to the other narrowed types.
- `canonicalAction`: `{ kind: 'sell_generator', generatorId: action.generatorId }`.
- `validateStrategyForMode`: unknown-generator check, identical to
  `buy_generator`'s.

### [apply.ts](../../shared/src/simulation/apply.ts)

- Widen `GameAction` with `SellGeneratorAction`.
- New case, using the shared validator so the sim can't drift from the server:

```ts
case 'sell_generator': {
  const reason = generatorSellBlockReason(state, action.generatorId, mode)
  if (reason === null) {
    applyGeneratorSell(state, action.generatorId, mode)
    return { status: 'applied' }
  }
  return classify(reason) // both sell reasons are permanent — never 'transient'
}
```

- Update the file's header comment: it currently says the applier handles "a
  single upgrade level, a single generator unit, or a highlight switch".

### [simulate.ts](../../shared/src/simulation/simulate.ts)

- `label()`: `` `sell:${action.generatorId}` `` — a distinct prefix from
  `gen:`, so event-log consumers can tell buys from sells. `labelId()` in
  [metrics.ts](../../shared/src/balance/metrics.ts) already slices at the first
  `:`, so it keeps working unchanged.
- `processCursor`: a **non-blocking** case next to `set_highlight` (a sell can
  never be `transient`, so it must never park the cursor), but unlike
  `set_highlight` it reports a permanent failure instead of swallowing it — a
  strategy that sells what it doesn't own is an authoring bug worth surfacing:

```ts
case 'sell_generator': {
  const result = applySimAction(state, action, modeDef, upgradeMap)
  if (result.status === 'applied') record(timeSec, action)
  else notReached.push({ index: cursor, action, reason: result.reason })
  cursor++
  continue
}
```

- `remainingCount` initialization is untouched (no `count` for sells).
- `blockReasonAtRoundEnd`: no change needed — a sell falls through to
  `'round-ended'`, which is correct for an action the cursor never reached.

### Consumers that must be touched (`pnpm typecheck` will list them)

`SimEvent.kind` is typed `SimAction['kind']`, so widening the union widens every
event consumer:

- **[metrics.ts](../../shared/src/balance/metrics.ts) `mechanicsUsed`** — leave
  the `default: break` arm as-is: a _sell_ must not mark a mechanic as "used".
  Add a comment saying so, or the next reader will assume it was an oversight.
- **[queue-model.ts](../../client/src/dev/queue-model.ts) `actionSummary`** —
  exhaustive switch; add
  `{ kind: 'sell generator', target: genName(action.generatorId), params: '' }`.
- **[queue-sim.ts](../../client/src/dev/queue-sim.ts)** — four spots:
  `ACTION_KINDS` (dropdown entry "Sell generator"), `paramsHtml` (generator
  `<select>`, no count input), `buildAction` (read `#q-generator`, fail on empty),
  `loadActionIntoForm` (`set('#q-generator', action.generatorId)`).
- **Chart helpers in [queue-sim.ts](../../client/src/dev/queue-sim.ts)** — these
  use inclusion-list filters, so sells are excluded by default. One deliberate
  call: **add sells to `markersFor`** (they matter when reading a curve) but
  **leave `cumulativePurchases` / `purchasePoints` counting buys only** — that
  line is a monotonic purchase count and must not go down.

### [live-export.ts](../../shared/src/simulation/live-export.ts)

`liveActionsToStrategy` gains the mapping that closes the drop-on-the-floor gap:

```ts
} else if (a.type === 'sell_generator' && a.generatorId !== undefined) {
  timed.push({ ms: a.timestamp, action: { kind: 'sell_generator', generatorId: a.generatorId } })
}
```

No `compress` rule (nothing to collapse without `count`); consecutive sells stay
as separate actions, which is exactly what the player did.

### Known limitation (document, don't fix here)

`countUses` in [metrics.ts](../../shared/src/balance/metrics.ts) counts **buy**
events to price a mechanic (`mechanicRawCost(entry, countUses(...))`), so a
sell-heavy build is charged its **gross** spend with no credit for refunds — its
mechanic cost reads high and its ROI low. Defensible (gross spend is what was
tied up) and out of scope here; the fix, if it's ever wanted, is to subtract
`GENERATOR_SELL_REFUND_RATE × cost` per `sell:` event in the same pass.

---

## Testing

Remember: `server`/`client` import **compiled** shared output — run
`pnpm --filter @game/shared build` before their suites.

### Refund math and state mutation — [shared/tests/generators.test.ts](../../shared/tests/generators.test.ts)

- `getGeneratorSellRefund` = `floor(0.5 × cost(owned-1))` on the exponential idler
  curve; `0` at `owned === 0`.
- Refund honours cost factors (assert via a mode with a `generatorCost` upgrade
  owned, comparing against `resolveGeneratorDef`).
- **The refund actually lands in resources:** `applyGeneratorSell` credits
  `resources[generatorCostCurrency(def)]` by exactly `getGeneratorSellRefund(...)`
  — assert the concrete before/after numbers, not just "increased".
- It credits **only** that currency: every other resource in the mode is
  byte-identical afterwards, and `score` is unchanged.
- `owned` decrements by exactly 1 (and only for the sold generator — other
  generators' counts untouched).
- No-op cases: unknown generator id, and `owned === 0` (resources, count and score
  all unchanged — not a negative count, not a free refund).
- Round-trip: `buy → sell` leaves `owned` unchanged, `score` unchanged, and
  resources down by exactly `cost − floor(cost/2)`.
- Repeated `sell → buy → sell → buy` cycling monotonically **drains** resources
  and never moves `score` (the anti-farm invariant, stated as a loop assertion).
- Property-ish: over a range of `owned`, refund ≤ next re-buy cost.

### Production actually goes down — [shared/tests/pipeline.test.ts](../../shared/tests/pipeline.test.ts) or [rate-breakdown.test.ts](../../shared/tests/rate-breakdown.test.ts)

The refund is only half the mechanic; the other half is that the player gives up
income. These are the tests that would catch a sell that credits resources but
forgets to decrement the count (or decrements a stale copy of the state):

- `computePassiveRates(collectModifiers(state, mode), mode.resources)` for the
  generator's produced resource is **strictly lower** after a sell, by exactly
  `def.production.rate ×` (whatever the pipeline multiplies it by) — easiest exact
  form: rate after selling from `n` to `n-1` equals the rate the same state had at
  `owned = n-1`.
- Selling down to `owned === 0` removes that generator's contribution entirely:
  `computeRateBreakdown(...).byGenerator[def.id]` is `0` (and `total` still equals
  `base + generators + upgrades`, the breakdown's own invariant).
- `applyPassiveTick` over a fixed number of ticks accrues strictly less of the
  produced resource after a sell than before.

### Count-reading effects re-evaluate — [shared/tests/effects.test.ts](../../shared/tests/effects.test.ts)

Selling is the first mechanic in the game that makes `state.generators` counts go
**down**, and three seed effects read those counts. They're pure functions of
current state so they should already be correct — these tests pin that:

- **`dominantGenerator` re-points.** Own `g0 = 5`, `g1 = 3`; the multiplier
  targets `g0`. Sell `g0` down to `2` and assert the emitted modifier's `field`
  flips to `g1`. Also: sell every copy of every generator → `max <= 0` → the
  effect returns `null` (no modifier, no crash).
- **`balancedGenerators` bonus changes.** From a skewed spread, selling down the
  leader **raises** `balanceRatio` and therefore the emitted `globalMultiplier`
  value; selling everything (`total <= 0`) returns `null`.
- **`lowerTierBoost`** recomputes from the reduced counts (assert the emitted
  modifier value moves in the expected direction).
- Sanity: none of the three throws or divides by zero anywhere on the way down to
  all-zero counts.

### Validation — shared: purchase-validation

`generatorSellBlockReason` returns `'unknown'` / `'not-owned'` / `null` in the
right cases; `isValidGeneratorSell` agrees with `reason === null`. Explicitly
assert **neither reason is `'unaffordable'`**, since the simulator branches on
that string to decide whether to wait.

### Simulator — [shared/tests/simulation.test.ts](../../shared/tests/simulation.test.ts)

- `parseStrategy` accepts a `sell_generator` action and rejects unknown extra keys
  (`strictObject`); `serializeStrategy` → `parseStrategy` round-trips it byte-stably.
- `validateStrategyForMode` reports an unknown generator id on a sell.
- `applySimAction` on a sell: `applied` when owned, `permanent`/`'not-owned'` when
  not, `permanent`/`'unknown'` for a bad id — and **never** `transient`.
- End-to-end `simulate`: a strategy of `buy_generator ×5 → wait → sell_generator`
  ends with 4 copies, resources up by the refund, and a lower `incomePerSec` in the
  post-sell snapshot than the pre-sell one. `finalScore` reflects the lost income.
- The run's `events` contain one `kind: 'sell_generator'`, `label: 'sell:g0'` entry
  at the expected time; a sell of an unowned generator lands in `notReached` with
  `'not-owned'` **and does not block the cursor** (later actions still fire).
- [metrics.test.ts](../../shared/tests/metrics.test.ts): a sell event does **not**
  mark a mechanic as used in `analyzeCoverage`.

### Live export — [shared/tests/live-export.test.ts](../../shared/tests/live-export.test.ts)

A recorded action list containing `sell_generator` exports a strategy that
contains the sell, in wall-clock order relative to the buys around it — the
regression test for the silent-drop bug this section exists to prevent.

### Dev panel — [client/tests/queue-model.test.ts](../../client/tests/queue-model.test.ts)

`actionSummary` renders a sell row (flavored generator name, no count column).

### Server — [server/tests/match.test.ts](../../server/tests/match.test.ts)

- A `sell_generator` action decrements the count and credits the refund;
  `score` is unchanged.
- The next `STATE_UPDATE` broadcast carries the reduced count and the increased
  resource total, and the following tick's passive income is measurably smaller.
- Invalid sells (unknown id, `owned === 0`, missing `generatorId`) are ignored and
  don't disturb other actions in the same batch.
- A sell does **not** appear in the espionage purchase feed.

### Client prediction — [client/tests/game.test.ts](../../client/tests/game.test.ts)

- `doSellGenerator` applies optimistically and queues one action; no-ops when
  `owned === 0`, when paused, and off the `playing` screen.
- **Reconciliation ordering** (the reason for the refactor): for both
  `buy → sell` and `sell → buy` of the same generator in one batch, the
  reconciled client state equals what the server produced from the same ordered
  action list. Assert on resources _and_ owned count.
- Existing prediction tests still pass unchanged after the `PendingBatch`
  refactor (that's the regression net).

### Client UI — [client/tests/components.test.ts](../../client/tests/components.test.ts)

- The card renders the sell button, disabled with `owned === 0`, and shows the
  refund figure when owned.
- The header rate label drops after a sell (the panel and the header must not
  disagree about production).

Then the full gate: `pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css` + all suites.

---

## Implementation order

1. Client `PendingBatch` → ordered `PredictedAction[]` replay (no behaviour
   change, own commit).
2. Shared: `GENERATOR_SELL_REFUND_RATE`, `getGeneratorSellRefund`,
   `canSellGenerator`, `applyGeneratorSell`, sell validators + the refund-math,
   production-drops and count-reading-effect tests.
3. Wire: `ActionType` widening.
4. Server: `processActions` branch, validation re-export, server tests.
5. Client: `doSellGenerator` + client tests.
6. UI: card row, `GeneratorCardNums.sellRefund`, `bind` branch, `style.css`,
   editor preview + `dev.css`, component test.
7. Simulator: `sell_generator` in `strategy.ts` / `apply.ts` / `simulate.ts`,
   then chase the consumer list with `pnpm typecheck` (metrics, queue-model,
   queue-sim), then `live-export.ts` + sim/live-export tests.

Steps 2–4 are independently shippable behind "no UI yet"; the feature only
becomes reachable at step 6. Step 7 is last because it's the widest diff and the
only one whose correctness is checked by the compiler pointing at every consumer
— but it must land in the same PR series, not "later", or the balance gate silently
under-reports and round exports silently lose actions.

---

## Deferred to future work

- **Bulk sell** (`Sell ×N` / `Sell all`) — add `getGeneratorBulkRefund` next to
  `getGeneratorBulkCost` and loop the mutator client-side exactly as
  `doBuyGeneratorMax` does (N discrete `sell_generator` actions, so the server
  needs no change at all). Deliberately out of scope here.
- **`count` on the sim's `sell_generator`** — optional field, so it can be added
  with the bulk-sell UI without a schema version bump. Pairs with a `compress`
  rule in `live-export.ts` collapsing consecutive sells of the same generator.
- **Net-of-refund mechanic costing** in [metrics.ts](../../shared/src/balance/metrics.ts)
  (see "Known limitation" above).
- **Espionage sell events** — a `kind: 'sell'` purchase-log entry so the feed
  stops implying a stale generator count (decision 7).
- **Bot selling** — no bot strategy uses it; would need a reason to sell before
  it's worth the search-space cost.
