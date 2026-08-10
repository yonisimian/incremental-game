# 28 — Cap resources and score at the double ceiling (stop the overflow-to-zero)

## Status: Draft

---

## The bug

Once a resource (or score) grows past what a JS double can hold, it becomes
`Infinity` — and the number the player sees **drops to 0**. The intended
behaviour for now: it should **stick at the ceiling** and stay there.

---

## Verified mechanism

Three steps, each confirmed in `node`:

1. **Overflow.** `Number.MAX_VALUE + Number.MAX_VALUE === Infinity`. Even
   `Number.MAX_VALUE * 1.0000001 === Infinity`. Doubles have no representation
   above `1.7976931348623157e308`, so one tick of passive income at the ceiling
   tips the stockpile to `Infinity`.
2. **The wire eats it.** `JSON.stringify({ x: Infinity })` → `{"x":null}` (same
   for `NaN`). Every server→client message goes through `JSON.stringify`
   ([main.ts](../../server/src/main.ts) `const payload = JSON.stringify(msg)`), so
   the `STATE_UPDATE` snapshot carries `null`, not a number.
3. **`null` reads as 0.** Client reads are all `resources[key] ?? 0`, and
   `null ?? 0` is `0`. So the panel renders **0**.

The visible sequence is therefore: a huge number → the literal string
`"Infinity"` (the client's own optimistic state is still a real double, and
[format-number.ts](../../client/src/ui/format-number.ts) returns `String(value)`
for non-finite input) → **0**, on the next server snapshot. That middle frame is
the tell that this is an overflow, not a reset.

`Number.MAX_VALUE` itself round-trips through JSON exactly
(`1.7976931348623157e+308`), so a **capped** value is wire-safe with no
serialization work.

---

## Three more failures the same overflow causes

Worth fixing in one pass, because they all disappear once values are capped:

- **The `NaN` cliff (worst of the three).** A geometric cost curve can also
  overflow, and `Math.floor(Infinity)` is `Infinity`. With a stockpile of
  `Infinity`, `isCostAffordable` compares `Infinity >= Infinity` → **true**, the
  purchase is allowed, and `resources -= Infinity` yields **`NaN`**. `NaN` fails
  every comparison, so the player can never buy anything again, and a `NaN` score
  makes both `p1.score > p2.score` and `<` false → the match reports a **draw**.
  Capping closes this permanently: `Number.MAX_VALUE >= Infinity` is `false`, so
  an overflowed cost is simply unaffordable — which is the correct answer.
- **Score / end screen.** An `Infinity` score wires as `null`, so
  `finalScores` renders 0 on the end screen and in the round-log export
  (`#112`).
- **Espionage and header rates.** `computePassiveRates` can return `Infinity`
  independently of the stockpile (e.g. `relativeModifier` reading a near-max
  stockpile, then any multiplicative stage on top). `view.rates` then wires as
  `null` → the opponent panel and the player's own header both show **0/s** while
  income is actually enormous.

---

## Decision: the cap is `Number.MAX_VALUE`

The true double ceiling is `1.7976931348623157e308`, not `1e308` — `1e308` is
merely the largest round power of ten below it. The requirement is "hold at the
maximum", so the cap is `Number.MAX_VALUE`: it's the real limit, it round-trips
through JSON exactly, and nothing is lost by using it.

If a tidier display value is ever preferred (`1e308` reads better in a
screenshot), that is a one-line change to the constant below and nothing else in
this plan moves.

```ts
// shared/src/game-config.ts

/**
 * Hard ceiling for any resource stockpile and for score. Past this, a double
 * becomes `Infinity`, which `JSON.stringify` wires as `null` and every client
 * read (`?? 0`) then turns into 0 — so an overflow reads as "you lost
 * everything". Values saturate here instead. Also the reason an overflowed cost
 * curve is safe: `MAX_RESOURCE >= Infinity` is false, so it's unaffordable
 * rather than producing `NaN`.
 */
export const MAX_RESOURCE = Number.MAX_VALUE
```

---

## The fix: one credit choke point

The core problem is that "credit a resource, and score if it's the score
resource" is currently **written out five times**, so there is nowhere to put a
single clamp:

| Site                                                                     | What it credits                     |
| ------------------------------------------------------------------------ | ----------------------------------- |
| [pipeline.ts:145-146](../../shared/src/modifiers/pipeline.ts#L145-L146)  | `applyPassiveTick` — passive income |
| [match.ts:510-511](../../server/src/match.ts#L510-L511)                  | `applyClick` — authoritative click  |
| [game.ts:386-387](../../client/src/game.ts#L386-L387)                    | `doClick` — optimistic click        |
| [game.ts:655-656](../../client/src/game.ts#L655-L656)                    | reconciliation click replay         |
| [simulate.ts:252-253](../../shared/src/simulation/simulate.ts#L252-L253) | sim background clicking             |

### 1. Add the helper (shared)

In [pipeline.ts](../../shared/src/modifiers/pipeline.ts), next to
`applyPassiveTick`:

```ts
/**
 * Credit `amount` of `resource` to `state`, saturating at {@link MAX_RESOURCE},
 * and mirror it into `score` when it's the score resource. The single place
 * resources grow — clamping here is what keeps every downstream number finite
 * (and therefore JSON-safe). A non-finite `amount` (an overflowed rate) saturates
 * rather than poisoning the stockpile; a `NaN` amount credits nothing.
 */
export function creditResource(
  state: PlayerState,
  resource: string,
  amount: number,
  scoreResource: string,
): void {
  if (Number.isNaN(amount)) return
  const gain = amount === Infinity ? MAX_RESOURCE : amount
  state.resources[resource] = Math.min(MAX_RESOURCE, (state.resources[resource] ?? 0) + gain)
  if (resource === scoreResource) state.score = Math.min(MAX_RESOURCE, state.score + gain)
}
```

Route all five sites above through it. Two properties this must preserve:

- **Score stays monotonic.** `Math.min(MAX, score + gain)` never decreases, so the
  "score never goes down" invariant holds at the cap too.
- **Resource and score clamp independently.** They're separate accumulators and a
  resource can be spent; clamping the pair together would let a purchase "unstick"
  the score.

Also route [match.ts:183](../../server/src/match.ts#L183)
(`grantResourcesForTest`) through it, so a test can't set up an unreachable state
the production path can't produce. And when plan
[26](./26-sell-generators.md)'s `applyGeneratorSell` lands, its refund credit goes
through this helper too rather than adding a sixth open-coded `+=`.

### 2. Clamp the rate outputs

`computeIncome`'s accumulators can overflow on their own, so the two functions
that turn a context into a number clamp their result:

- `finalizeRate` → `Math.min(MAX_RESOURCE, combined)`
- `computeClickIncome` → `Math.min(MAX_RESOURCE, ctx.clickIncome)`

That keeps `computePassiveRates` (header, espionage `view.rates`, the data panel's
`computeRateBreakdown`, and every sim snapshot's `incomePerSec`) finite, so no
rate can wire as `null` either. `computeRateBreakdown` differences clamped runs,
so its `total === base + generators + upgrades` invariant is preserved — but pin
it with a test at the ceiling, because saturation is where telescoping sums are
most likely to break.

### 3. One rounding trap in the simulator

[simulate.ts](../../shared/src/simulation/simulate.ts) ends with
`finalScore: Math.round(state.score * 100) / 100`. At the cap, `MAX_VALUE * 100`
is `Infinity`, so a **clamped** score still yields an `Infinity` `finalScore`.
Guard it: round only when the score is small enough to survive the ×100, e.g.
`state.score > MAX_RESOURCE / 100 ? state.score : Math.round(state.score * 100) / 100`.

### 4. What deliberately stays unclamped

- **Cost curves** (`scaledCost`, `getUpgradeNextCost`, `getGeneratorCost`,
  `getGeneratorBulkCost`). An `Infinity` cost is _correct_ — the thing is
  unaffordable — and it is only safe **because** stockpiles are capped below
  `Infinity`. That dependency is the reason step 1 and step 4 belong in the same
  plan. A cost display reading `"Infinity"` is acceptable for now.
  **This is a working assumption, not a settled decision — see
  [Open questions](#open-questions--the-cost-side-of-the-overflow), Q1/Q2.**
- **Modifier values.** Effects can produce huge multipliers; the clamp belongs at
  the accumulation boundary (steps 1–2), not scattered across effects.
- **No client-side repair.** Tempting to make snapshot ingestion coerce
  `null`/non-finite numbers, but the server is authoritative and, once clamped,
  cannot emit them. Adding a second repair layer would hide a future regression
  instead of failing a test. Skip it.

---

## Open questions — the cost side of the overflow

Capping stockpiles fixes the reported bug and closes the `NaN` cliff, but it does
**not** decide what should happen to _prices_ as they approach and pass the double
ceiling. These are genuinely open — I have a leaning on some, but none of them
should be settled by whoever implements the plan without a call from the author.

Grounding facts, measured rather than guessed:

- Idler has **33 scaled cost entries**. `g0`/`g1` (`10 × 1.15^n`) produce a cost
  above `Number.MAX_VALUE` at **n ≈ 5063** — the copy before it prices at
  `1.788e308`, just under the cap. `g3` (`600 × 1.5^n`) overflows at **n ≈ 1737**.
- `Math.floor(Infinity)` is `Infinity`, and `formatNumber` passes non-finite values
  through as `String(value)` — so an overflowed price renders as the literal
  **`"Infinity"`** on the button today.
- There is **no per-batch action cap**: `match.ts`'s `ACTION_BATCH` handler feeds
  `msg.actions` straight to `processActions`. Only clicks are rate-limited
  (`isValidClick`); buys and generator buys are not.

**Q1 — Clamp costs too, or let them overflow? (blocks step 4.)**
The plan currently assumes "let them overflow, an `Infinity` price is honestly
unaffordable". The alternative — clamp costs to `MAX_RESOURCE` — has a nasty edge:
a player sitting exactly at the cap would then satisfy `MAX >= MAX`, buy the thing,
and drain the stockpile to ~0. That looks like the very bug being fixed, so my
leaning is _don't clamp costs_. But it means the top of every curve is
**permanently unbuyable** rather than merely expensive. Which reads better to you?

**Q2 — What should an unaffordable-forever price display as?**
`"Infinity"` on a disabled button is honest but ugly, and it is the only place a
player would ever see the word. Options: leave it; render `—` or `MAX`; or hide the
buy row entirely at that level. Purely cosmetic, so it can land later — but if the
answer is "never show `Infinity`", the clamp belongs in the **formatter**, not in
the cost helpers, and that is worth knowing before someone puts it in the wrong
layer.

**Q3 — Is an emergent wall at ~5,000 / ~1,740 copies acceptable?**
Right now the "you can never buy another one" point is wherever IEEE-754 happens
to run out, per curve — not an authored game decision. Note the wall sits
effectively **on top of** the resource cap (a price of `1.788e308` versus a cap of
`1.798e308`), so affordability runs out at essentially the same moment; the float
range is doing the design's job by coincidence. Should curves instead carry an
explicit `purchaseLimit` so the ceiling is authored data, or is relying on the
coincidence fine for now?

**Q4 — Bulk cost display near the cap.**
`getMaxAffordableGeneratorCount` walks copy-by-copy and can legitimately return a
large `N`, while `getGeneratorBulkCost` sums those prices and can overflow to
`Infinity` on its own. The button would then read `Buy ×N — Infinity` for a
purchase that is actually valid. Clamp the bulk _sum_ for display only, or accept
it? (Related to Q2, but distinct: here the number is wrong, not just ugly.)

**Q5 — Buy-Max action volume, and whether it belongs in this plan.**
`doBuyGeneratorMax` queues **one action per copy**, and nothing caps batch size
server-side. Near the cap a single Buy-Max click could enqueue thousands of
`buy_generator` actions in one batch — wire size and a tick-time spike, with no
validator in the way. Is that worth a per-batch cap (or a bulk action with a
`count`)? And if so, does it belong here, in plan
[26](./26-sell-generators.md)'s bulk-sell follow-up, or in its own plan? It is not
strictly an overflow bug, which is why I have not folded it into the fix.

**Q6 — Audit item, needs verification during implementation.**
The `NaN` cliff closes only if **every** cost subtraction is preceded by an
affordability check. `applyPurchase` and `applyGeneratorPurchase` are both reached
through validators on the server, client and simulator paths — but I have not
exhaustively proven there is no third path that debits without checking. Worth
confirming (and pinning with a test) rather than assuming; if one exists, the clamp
belongs in the debit helper too, symmetrically with `creditResource`.

---

## Consequences accepted (this is a stopgap)

- **Two capped players tie.** Both scores saturate at the same value, `p1.score
=== p2.score`, and the match reports a **draw**. Inherent to a hard cap; the
  real answer is a bigger number representation (see Deferred).
- **The cap is reachable and then the game is over as a contest** — income keeps
  being produced but score stops moving. Fine for "stay at the max for now",
  worth knowing before someone treats it as a balanced end state.
- **Displayed rates can be huge but finite**, e.g. `1.8e308/s`. Correct, if
  absurd.

---

## Testing

`server`/`client` import compiled shared output — `pnpm --filter @game/shared build`
before their suites.

### The core cap — [shared/tests/pipeline.test.ts](../../shared/tests/pipeline.test.ts)

- `creditResource` saturates: from `MAX_RESOURCE`, crediting any positive amount
  leaves the resource at exactly `MAX_RESOURCE` — **not** `Infinity`, **not** `0`.
- Score saturates the same way, and never decreases across a saturating credit.
- A non-finite `amount` (`Infinity`) saturates; `NaN` credits nothing and leaves
  both the resource and score untouched.
- Crediting a non-score resource at the cap does not move `score`.
- `applyPassiveTick` with an enormous rate (e.g. a `1e308` native modifier) over
  several ticks holds at `MAX_RESOURCE` every tick, and `state.score` tracks it.
- `finalizeRate` / `computeClickIncome` return `MAX_RESOURCE`, not `Infinity`,
  when the modifier stack overflows.

### The regression that names the bug — server

In [server/tests/match.test.ts](../../server/tests/match.test.ts): drive a player
to the cap, take the broadcast `STATE_UPDATE`, and assert
`JSON.parse(JSON.stringify(msg))` contains **no `null` and no non-finite** numbers
in `player.resources`, `player.score`, or `opponent.rates`. This is the test that
would have caught the original bug, and it fails loudly if any future code path
reintroduces an `Infinity` on the wire. A round-trip helper walking the message
numerically is worth the ~15 lines.

Also: with a capped stockpile and an overflowed cost, a `buy` action is **rejected**
(not applied), and the resource stays exactly `MAX_RESOURCE` — the `NaN`-cliff
regression test.

### End of round

`ROUND_END`'s `finalScores` survive the round trip as finite numbers; two capped
players produce `winner: 'draw'` (documenting the accepted consequence, so a later
change to it is a deliberate edit to this test).

### Client

- [client/tests/game.test.ts](../../client/tests/game.test.ts): optimistic
  `doClick` at the cap holds at `MAX_RESOURCE`; reconciliation replay of a capped
  batch converges to the same value as the server's (no drift from the clamp being
  applied a different number of times — this is why both paths must use the same
  helper).
- [client/tests/format-number.test.ts](../../client/tests/format-number.test.ts):
  `formatNumber(MAX_RESOURCE)` renders sensibly in all three notations (`name`
  falls back to scientific past its suffix table, which is the intended path).
  Worth also pinning `formatNumber(Infinity)` → `"Infinity"` so the diagnostic
  middle frame stays diagnostic rather than silently becoming `"0"`.

### Simulator

[shared/tests/simulation.test.ts](../../shared/tests/simulation.test.ts): a run
that saturates reports a **finite** `finalScore` equal to `MAX_RESOURCE` (the
`Math.round(x * 100)` trap), and its snapshots' `incomePerSec` values are all
finite.

Full gate: `pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css`
plus all three suites.

---

## Implementation order

1. `MAX_RESOURCE` + `creditResource` in shared, with the pipeline tests. Route
   `applyPassiveTick` through it.
2. Clamp `finalizeRate` and `computeClickIncome`.
3. Route the four remaining credit sites (server click, client click ×2, sim
   click) through the helper — this is the de-duplication half of the change and
   is worth its own commit.
4. The simulator `finalScore` rounding guard.
5. The JSON round-trip regression test + the `NaN`-cliff test.
6. Client/format tests.

Steps 1–2 fix the reported bug on their own; step 3 is what stops it coming back
through one of the copies.

---

## Deferred

- **A real big-number layer.** The honest fix for an incremental game that can
  reach `1e308` is a mantissa/exponent representation (`{ m, e }` or a decimal
  library) for resources and score, with the wire format and the modifier
  pipeline built on it. That is a large, cross-cutting change — cap first, decide
  later, and revisit if the cap is being hit in normal play rather than in
  runaway builds.
- **A softcap / diminishing-returns curve** approaching the ceiling, so hitting
  the wall feels designed rather than abrupt. Needs the balance work in
  [BALANCE.md](../BALANCE.md), not just a clamp.
- **Negative-resource guard.** Purchase validation makes debits below zero
  unreachable today, so `creditResource` deliberately doesn't clamp the low end.
  If a future mechanic can subtract freely, that guard belongs in the same helper.
