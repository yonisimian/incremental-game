# 46 — Forward-only generator cost scaling

## Status: Proposed

---

## Problem

A `generatorCost` upgrade with `scalingFactor < 1` (e.g. `g1-dpf`, 0.9 per
level, unlimited) is **retroactive**. The price is closed-form from level 0:

```text
price(n) = floor(base · cf · r'ⁿ),   r' = 1 + (r − 1) · sf
```

So lowering `sf` reprices every copy already owned. With 50 copies at r = 1.15,
five levels of `g1-dpf` cut the next price ~15× (1.15⁵⁰ ≈ 1083 → 1.089⁵⁰ ≈ 70).
The more copies you own, the more the upgrade is worth. That's the opposite of
the intent "prices grow more slowly **from now on**".

`costFactor` is not affected. It multiplies every level equally, so retroactive
and forward-only give the same prices. No change there.

## Decision

Forward-only: a scaling upgrade bends the curve **from the current copy on**.
Copies already owned keep their prices. This makes the scaling upgrades much
weaker late in the round and much stronger early on, which rewards buying them
early. `g1-dpf` … `g4-dpf` are retuned in the same branch (see "Retune").

## Approach: anchor the curve when own scaling changes

When an upgrade purchase changes a generator's **own** scaling factor, move
that generator's curve so the price stays the same at the current owned count
`A` and grows at the new rate from there on. Store one number per generator:
the **anchored base cost** `b`, used in place of the authored `baseCost`.

Curve without `costFactor`, before the change: `C(n) = b · r_old^n`
(exponential) or `b + inc_old · n` (linear). After the change:

```text
exponential:  b' = C(A) / r_new^A
linear:       b' = C(A) − inc_new · A      (inc_new < inc_old ⇒ b' > b > 0)
```

At read time, `resolveGeneratorDef` swaps `b` into the entry, then applies
factors exactly as today. Everything downstream (`getGeneratorCost`, bulk buy,
max-affordable, sell refund, bot, UI, validation) already goes through that one
function, so none of it changes.

### What stays retroactive (on purpose)

- **`costFactor`**: a uniform multiplier, so the price is the same either way.
- **Stamped factors** (enemy `enemyCostModifier`, pact `mirrorCostModifier`):
  these come and go. They stay out of the anchor and apply on top at read time,
  as they do now. When they're applied to the anchored entry, the ratio to the
  un-attacked price is `(r_eff / r_own)^n`, the same as today. Attack strength
  doesn't depend on anchors, and nothing sticks after an attack ends.

### Where the anchor is written

In the grant step of an upgrade purchase, and only when the upgrade has a
`generatorCost` ref (so almost every purchase skips it):

```ts
// shared/src/modes/index.ts
export function grantUpgradeLevel(state: PlayerState, id: string, mode: ModeDefinition): void {
  const def = mode.upgrades.find((u) => u.id === id)
  const touchesCost = def?.effects?.some((e) => e.type === 'generatorCost') ?? false
  const before = touchesCost ? collectGeneratorCostFactors(state, mode, 'sell') : undefined
  state.upgrades[id] = (state.upgrades[id] ?? 0) + 1
  if (before) anchorGeneratorCurves(state, mode, before) // generators.ts
}
```

`'sell'` purpose is already "own factors only", so no new collector is needed.
`anchorGeneratorCurves` skips a generator when its `scalingFactor` didn't
change, when it has a flat curve, or when it has `owned === 0`. In all three
cases the new base equals the old one, so the state stays empty.

Both `applyPurchase` (server, simulator, client's optimistic buy) and the
client's reconcile replay (`grantUpgrade` in
[game.ts](../../client/src/game.ts), which doesn't go through `applyPurchase`)
call `grantUpgradeLevel`. Otherwise a generator buy replayed after a scaling
upgrade in the same batch would be priced retroactively, and the client would
mispredict.

### Storage: a typed top-level `PlayerState` field

```ts
/** Per-generator base cost after forward-only scaling changes; absent = authored base. */
generatorCostBases?: Record<string, number>
```

Why top-level and not `meta`: the `PlayerState` docs already set the rule
that engine-level, wire-stable fields used in reconciliation live at the top
level, and mode-specific data goes in `meta` (see `incomingCostFactors`).
Prices are checked by the server, so this belongs on the typed side. It also
means no defensive reader is needed.

It's optional and absent by default (the same convention as
`incomingCostFactors`), so `createInitialState` and any snapshot without it
stay valid. The client's `clonePlayerState` copies it; reconciled buys must be
priced from the server's anchors. `playerWithoutGenerators` doesn't need it,
because it only feeds production rates.

## Behavior at the edges

| Case                               | Result                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scaling upgrade bought at 0 owned  | Same as today (nothing stored).                                                                                                                                                   |
| Several levels at different counts | Anchors chain: each level moves the curve at the owned count at that moment.                                                                                                      |
| Selling below the anchor           | The new rate is used going backward, so those copies are priced **above** what was paid. Buy and sell share the curve and the refund is 50%, so this can't be used to make money. |
| Raid moves generators              | Owned count moves along each player's own curve. Consistent.                                                                                                                      |
| Sell down → buy scaling → rebuy    | The anchor sits at a lower count, so rebuying is cheaper. The player gets partial retroactivity for 50% of the sold copies' value. Accepted as a legitimate strategy.             |

Floating point: `C(A) / r^A · r^A` can land a hair off `C(A)`. It's the same
kind of error `base · rⁿ` already has, and client and server run identical
operations, so they can't desync. Tests compare unfloored values with
`toBeCloseTo`.

## Files touched

- `shared/src/types.ts`: `PlayerState.generatorCostBases`.
- `shared/src/generators.ts`: `anchorGeneratorCurves`. `resolveGeneratorDef`
  reads the anchored base.
- `shared/src/modes/index.ts`: `grantUpgradeLevel`, used by `applyPurchase`.
- `client/src/game.ts`: the replay's `grantUpgrade` becomes `grantUpgradeLevel`
  (the local helper is deleted), and `clonePlayerState` copies the new field.
- `shared/trees/idler.json` (and `shared/strategies/idler/*.json` /
  `shared/balance/idler.json` if the retune requires it).
- `shared/src/effects/seed/generator-cost.ts`, `shared/src/effects/types.ts`:
  doc lines for `scalingFactor` say "from the current copy on".

## Complexity check

- **New state:** one number per generator, written only when a scaling upgrade
  is bought. That's the minimum any forward-only design needs.
- **New functions:** 2 (`grantUpgradeLevel`, `anchorGeneratorCurves`). One
  helper is deleted from the client.
- **Not doing:** upgrade-cost scaling. No friendly effect changes an upgrade's
  own scaling today ([upgrade-costs.ts](../../shared/src/upgrade-costs.ts)), and
  stamped factors stay retroactive by design. When such an effect is added, the
  same anchor pattern applies per upgrade level. Building it now would be
  speculative.

## Tests

Logic unit tests only. Nothing new crosses the client/server boundary; the
anchor rides the existing snapshot.

- `shared/tests/generators.test.ts`:
  - Scaling upgrade at 0 owned: prices identical to today.
  - At 20 owned: the price of copy 20 is unchanged by the purchase, and copy
    21 = copy 20 · r_new.
  - Two levels bought at 10 and 20 owned: anchors chain.
  - Linear curve: same continuity property.
  - `costFactor` upgrade: still reprices all levels (nothing stored).
  - Enemy `scalingFactor` stamped on an anchored curve: same ratio as on the
    un-anchored one, and the price returns exactly once it's removed.
  - Sell below the anchor, then rebuy: same curve both ways, the anchor doesn't
    move, and refund < rebuy price.
- `client/tests/game.test.ts` (`STATE_UPDATE`): a pending batch of [buy scaling
  upgrade, buy generator] replays at the anchored price, and a snapshot's
  `generatorCostBases` survives `clonePlayerState`.

## Retune

This goes in a separate commit after the mechanics commit, so the balance
effect can be seen on its own.

1. **Baseline** before the mechanics change:
   `tsx scripts/check-balance.ts --suggest --analyze`. Record per-strategy
   scores and the coverage/dominance findings for the `g*-dpf` nodes.
2. **Measure** the same command after the mechanics change, and note which
   envelopes or pacing checkpoints move and whether the dpf nodes drop out of
   the strategies that buy them.
3. **Tune** the dpf nodes, not the envelopes. In order of preference:
   - Strengthen `scalingFactor` (e.g. 0.9 → 0.8). This keeps the same node,
     makes each level stronger, and fits "buy it early".
   - Make the node's own cost curve cheaper, so it's reachable earlier in the
     round, where forward-only pays off.
   - Only if a strategy JSON hard-codes a buy order that no longer makes sense,
     update that strategy.
4. **Done when** `check-balance` passes without widening any envelope, and the
   dpf nodes still show up as bought by at least one viable strategy (they
   aren't dead nodes).

Changing envelope bands is out of scope. If the numbers can't land inside the
current bands, I stop and report back rather than moving the goalposts.

## Resolved questions

1. Forward-only: yes.
2. Storage: typed top-level `PlayerState` field.
3. Sell-down → rebuy strategy: accepted.
4. Retune: same branch, separate commit.
