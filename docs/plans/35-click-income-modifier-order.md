# 35 — Click income: an explicit order for additive and multiplicative

## Status

Two halves, two statuses:

- **"Where it stands today"** is current behaviour, verified against `tal/main`
  as of 2026-09-11. Every number in it was produced by running the real idler
  tree through `collectModifiers` / `collectEnemyDebuffs` / `computeClickIncome`.
- **"The change"** onward is **proposed, not implemented**.

---

## Goal

Give the `clickIncome` track a **defined composition order** — multiply first,
then apply flat drains — instead of the current "whatever order the modifiers
happen to arrive in". Today a click debuff's real strength is decided by the line
order of the mode JSON, and so is the worth of some of the player's _own_ click
upgrades.

---

## Where it stands today

### `clickIncome` is the one un-layered track

Resource rates are **layered**: every modifier is routed into one of four
accumulators and the rate is composed once, at the end
([pipeline.ts:88-89](../../shared/src/modifiers/pipeline.ts#L88-L89)):

```ts
const base = layers.base.add * layers.base.mult
return saturateRate((base + layers.global.add) * layers.global.mult)
```

Adds and mults land in different buckets, so a resource rate is **independent of
modifier order** — arrival order only decides the order of a `+=` or a `*=`
within one accumulator, and both are commutative.

The click track has no layers. It is a single running number folded in place as
each modifier is seen ([pipeline.ts:59-63](../../shared/src/modifiers/pipeline.ts#L59-L63)):

```ts
if (m.field === 'clickIncome') {
  if (m.stage === 'additive') ctx.clickIncome += m.value
  else ctx.clickIncome *= m.value
  continue
}
```

`+=` and `*=` interleaved do **not** commute, so the array order is part of the
formula. `computeClickIncome` then floors at 0 and saturates
([pipeline.ts:125-127](../../shared/src/modifiers/pipeline.ts#L125-L127)); the
floor is the only thing standing between an overshooting flat drain and negative
click income.

### What decides that array order

The array is `[...own modifiers, ...incoming debuffs]`, assembled identically on
the server ([match.ts:636-643](../../server/src/match.ts#L636-L643)), the client
prediction ([game.ts:882-895](../../client/src/game.ts#L882-L895)) and the data
panel ([data-panel.ts:522-523](../../client/src/ui/panels/data-panel.ts#L522-L523)).
Within each half, order is fixed by static mode data:

**Own modifiers** — [`collectRawModifiers`](../../shared/src/modes/index.ts#L756):

1. mode `startingEffects`, in array order
   ([modes/index.ts:816-818](../../shared/src/modes/index.ts#L816-L818));
2. then **owned upgrades in flattened-tree pre-order**
   ([modes/index.ts:822-828](../../shared/src/modes/index.ts#L822-L828)) — parent
   before child, siblings in JSON array order, per
   [`flattenUpgradeTree`](../../shared/src/modes/upgrade-tree.ts#L32-L56);
3. within one upgrade, its own `effects` array order;
4. then the highlight battery ([modes/index.ts:837-841](../../shared/src/modes/index.ts#L837-L841)),
   which never targets `clickIncome`.

**Incoming debuffs** — [`collectEnemyDebuffs`](../../shared/src/modes/index.ts#L1094)
walks `unlockedAttacks`, which is [`allAttackIds`](../../shared/src/unlock-gates.ts#L152)
filtered by what the attacker owns. `allAttackIds` is the key order of a Map built
once at boot by scanning the mode's own effects and then its upgrades for
`unlockAttack` refs ([unlock-gates.ts:111-112](../../shared/src/unlock-gates.ts#L111-L112)),
first-encounter-wins. It takes **no player state**, so ownership can only filter
that list, never reorder it. Two attacks unlocked by the same upgrade are ordered
by that upgrade's `effects` array; two attacks unlocked by different upgrades are
ordered by those upgrades' pre-order slots.

Nothing anywhere reads unlock chronology — `PlayerState.upgrades` is a
`Record<string, number>` of counts, with no timestamps and no purchase order.

### Consequence 1 — some of the player's own click upgrades are order-sensitive

The idler click branch mixes stages across four upgrades (flat pre-order slot in
brackets):

| Slot | Upgrade     | Effect                        | Stage          |
| ---- | ----------- | ----------------------------- | -------------- |
| 32   | `sc-unlock` | `baseModifier` +1             | additive       |
| 33   | `sc-af-cp`  | `baseModifier` +1 (× owned)   | additive       |
| 34   | `sc-mf-cp`  | `baseModifier` ×1.1 (^ owned) | multiplicative |
| 47   | `sc-pcps`   | `relativeModifier` + peak CPS | additive       |

`sc-pcps` sits at slot 47, **after** the multiplier at slot 34, so its bonus is
appended after the `*=` has already run and never gets multiplied. With
`sc-unlock`, `sc-af-cp ×3`, `sc-mf-cp ×2` and `sc-pcps` at peak CPS 4:

```text
emitted order:  +1, +3, ×1.21, +4
income:         ((0 + 1 + 3) × 1.21) + 4  =  8.84
if sc-pcps sat anywhere above slot 34:
                 (0 + 1 + 3 + 4) × 1.21   =  9.68     (+9.5%)
```

That 9.5% is not a balance decision anyone made — it is where the node happens to
sit in the tree. Move `sc-pcps` above `sc-mf-cp` in [idler.json](../../shared/trees/idler.json)
and click power changes with no effect edited.

### Consequence 2 — two click attacks compose by JSON line order

Idler authors both stages of click debuff, and `node-7` unlocks both together:

| Attack                 | Effect                         |
| ---------------------- | ------------------------------ |
| `less-click-power`     | `enemyProductionModifier` ×0.5 |
| `less-click-power-add` | `enemyProductionModifier` −2   |

`node-7` lists `less-click-power` first, so the debuffs arrive `[×0.5, −2]` and a
click resolves as `(power × 0.5) − 2`. Swap those two `unlockAttack` lines and the
same two attacks become `(power − 2) × 0.5`. Against the 8.84 above: **2.42 vs
3.42** — 41% more click income from reordering two lines of JSON.

Verified, including that purchase order is irrelevant:

```text
×0.5 on sc-unlock (slot 32), -2 on sc-af-cp (slot 33)
  order: ×0.5, -2     — bought mult first: same; bought flat first: same
swapped onto the other node
  order: -2, ×0.5     — bought mult first: same; bought flat first: same
```

The server-side comment at [match.ts:633-635](../../server/src/match.ts#L633-L635)
("appended last so a `clickIncome` debuff scales the finished figure") describes
the intent, and it holds for the multiplicative debuff. It is exactly what makes
the additive one order-dependent.

### What the player is told

The data panel's Clicking section reports the two stages on separate rows —
`⚔️ Enemy debuff (flat) -2` and `⚔️ Enemy debuff (mult) ×0.5`
([data-panel.ts:344-351](../../client/src/ui/panels/data-panel.ts#L344-L351),
[showClickDebuffs](../../client/src/ui/panels/data-panel.ts#L599)). They are shown
per stage precisely _because_ no single combined factor is true: any ratio would
be an artifact of the ordering above. Once this plan lands, a combined figure
becomes well-defined and the rows could carry one.

---

## The change

### Why a naive "all multiplicative, then all additive" cannot work

The click track starts at **0** ([pipeline.ts:50-53](../../shared/src/modifiers/pipeline.ts#L50-L53))
and its base _is_ the additive bucket — `sc-unlock`'s `+1` is where click income
comes from at all. Running every multiplicative modifier first means multiplying
0, so the mults vanish and the result collapses to `Σ add`. "Multiply, then add"
is only meaningful with **two layers**: something has to exist to be multiplied
before the flat term lands. That is what resources already do, and it is the
shape proposed below.

### The provenance problem

`computeIncome` receives one flat `Modifier[]` with no record of who contributed
what — the victim's own `+1` and the enemy's `−2` are structurally identical. So
a layered click track needs a way to tell own bonuses from incoming debuffs.

Resources already solve this **by field name**: `b0` routes to the base layer and
`r0` to the global layer ([pipeline.ts:27-36](../../shared/src/modifiers/pipeline.ts#L27-L36)).
The click track can borrow it, and there is already a seam that rewrites debuff
fields on the way in: [`resolveEnemyDebuffs`](../../shared/src/modes/index.ts#L1177)
translates the virtual `highlightFactor` target and is called on **both** sides at
every point debuffs enter a pipeline. Authors keep writing
`field: "clickIncome"` on an attack; `resolveEnemyDebuffs` maps it to a
global-layer key (say `clickIncome:incoming`); `computeIncome` routes that key to
the incoming layer. No change to the `Modifier` type, the wire format, the editor
dropdown, or anything authored.

### The three candidate formulas

With `ownAdd`/`ownMult` from the player's upgrades and `enemyAdd`/`enemyMult`
from incoming debuffs, all floored at 0:

| #   | Formula                                     | Order                                              |
| --- | ------------------------------------------- | -------------------------------------------------- |
| 1   | `(ownAdd + enemyAdd) × ownMult × enemyMult` | all adds, then all mults — one layer               |
| 2   | `(ownAdd × ownMult + enemyAdd) × enemyMult` | own layer, then incoming layer — mirrors resources |
| 3   | `ownAdd × ownMult × enemyMult + enemyAdd`   | flat drain applied last, unscaled                  |

Against the idler click branch (`sc-unlock`, `sc-af-cp ×3`, `sc-mf-cp ×2`,
`sc-pcps`), with both enemy click attacks in force:

| Own state        | Own parts  | Today | 1     | 2     | 3     |
| ---------------- | ---------- | ----- | ----- | ----- | ----- |
| unlock only      | +1, ×1     | 0     | 0     | 0     | 0     |
| + 3 flat         | +4, ×1     | 0     | 1     | 1     | 0     |
| + ×1.1²          | +4, ×1.21  | 0.42  | 1.21  | 1.42  | 0.42  |
| + pcps (peak 4)  | +8, ×1.21  | 2.42  | 3.63  | 3.84  | 2.84  |
| + pcps (peak 20) | +24, ×1.21 | 10.42 | 13.31 | 13.52 | 12.52 |

Undebuffed, all three agree with each other and differ from today only where the
`sc-pcps` quirk bites (8.84 → 9.68).

**What separates them** is what a flat drain of `−2` _means_:

- **Option 1** — the drain is scaled by the victim's **own** multipliers, so
  buying click multipliers amplifies the enemy's flat attack against you. Perverse,
  and it makes the attack's worth depend on the victim's build in the wrong
  direction. It is the smallest change (bucket the track; no provenance needed),
  so it is the fallback if the layering is judged too invasive.
- **Option 2** — the drain takes a flat amount off the victim's finished click
  power, then the enemy's own factor scales the result. Its final cost is
  `2 × enemyMult`, independent of the victim's build. **This is exactly how an
  enemy flat rate debuff already behaves on the resource track** (it lands in
  `global.add` alongside generator output, then `global.mult` applies), so it
  introduces no new semantics — one formula covers both tracks.
- **Option 3** — `−2` always costs exactly 2, whatever else is in play. The most
  legible authoring promise, and it happens to reproduce today's idler ordering
  (so the attack pair needs no rebalancing). The cost is that clicks then compose
  by a formula resources do not use.

**Recommendation: Option 2.** It is the only one that makes the click track
identical in shape to the resource track — the same four accumulators, the same
`(base.add × base.mult + global.add) × global.mult`, own bonuses in `base` and
incoming debuffs in `global`. Authors and players get one rule to learn, and
`ResourceLayers` / `finalizeRate` are reused rather than paralleled. Option 3 is
the pick if "a flat debuff means a flat number" is worth a bespoke formula.

---

## Changes required

### 1. A global-layer key for the click track

Add the key next to the existing virtual target
([effects/addressable.ts:36-43](../../shared/src/effects/addressable.ts#L36-L43)) and
into `RESERVED_TARGET_KEYS` so a mode can't declare a resource that collides with
it. It is **not** added to `enemyDebuffTargetsFor`
([addressable.ts:127-133](../../shared/src/effects/addressable.ts#L127-L133)) —
authors keep targeting `clickIncome`, so the editor dropdown
([effects-editor.ts:119](../../client/src/dev/editor/effects-editor.ts#L119)) and
every authored tree are untouched.

### 2. `resolveEnemyDebuffs` rewrites the field

[modes/index.ts:1177-1192](../../shared/src/modes/index.ts#L1177-L1192) gains a
second translation alongside the `highlightFactor` one: a debuff naming
`clickIncome` comes out naming the incoming-layer key. Because every pipeline
entry point already calls this (server income, server clicks, client prediction,
data panel), no call site changes. The wire still carries the **unresolved** form,
which is what lets the data panel report the debuff at all — same reasoning as the
highlight target.

Note the ordering consequence: the resolver is what makes the distinction, so a
debuff that bypasses it (any new call site that forgets) would silently land in the
victim's _own_ layer. Worth an assertion or a test.

### 3. `ModifierContext.clickIncome` becomes layered

[modifiers/types.ts:67-72](../../shared/src/modifiers/types.ts#L67-L72) — `clickIncome:
number` becomes `ResourceLayers` (the existing interface; no new type). In
`computeIncome`, the standalone-track branch
([pipeline.ts:58-63](../../shared/src/modifiers/pipeline.ts#L58-L63)) routes into
`base`/`global` by field key instead of folding in place, and `computeClickIncome`
([pipeline.ts:125-127](../../shared/src/modifiers/pipeline.ts#L125-L127)) composes
via `finalizeRate` and keeps its `Math.max(0, …)` floor.

Blast radius is small: `ctx.clickIncome` is read in exactly one place
(`computeClickIncome`), and `computeIncome` has no consumers outside the pipeline
and its own tests.

### 4. The data panel can state a combined figure

With the order defined, the two rows
([data-panel.ts:344-351](../../client/src/ui/panels/data-panel.ts#L344-L351)) can
keep their per-stage values _and_ gain a true combined factor, or say where each
lands ("−2 after your multipliers"). Optional, and best decided once the formula
is picked.

---

## Balance impact

- **Own click power rises** for any build holding `sc-mf-cp` **and** `sc-pcps` —
  +9.5% in the worked case, more as peak CPS grows, since `sc-pcps` starts getting
  multiplied. `sc-pcps` is bought by several checked-in strategies
  ([click-rush.json](../../shared/strategies/idler/click-rush.json),
  [base.json](../../shared/strategies/idler/base.json), both `real-tal` runs), so
  the balance sim ([simulation/simulate.ts:265](../../shared/src/simulation/simulate.ts#L265))
  and any envelope tuned against it shift.
- **Click debuffs get weaker** under Options 1 and 2 (2.42 → 3.63/3.84 in the
  worked case), because the flat drain stops landing on an already-halved figure.
  Option 3 keeps today's numbers for the attack pair. If the current strength is
  wanted, retune the authored `value` rather than relying on the ordering — the
  point of this change is that the number becomes a decision instead of a
  side effect.
- **No wire or persistence change**, so no migration: this is pure arithmetic
  inside the pipeline plus one field rename inside `resolveEnemyDebuffs`.

---

## Tests to update

- [shared/tests/pipeline.test.ts:129-176](../../shared/tests/pipeline.test.ts#L129-L176)
  encodes the current sequential arithmetic directly: `(4 × 2) × 0.5 = 4` for "a
  multiplicative debuff appended last", `(1+1) × 2 = 4` via `ctx.clickIncome`, and
  the additive-overshoot floor. The `ctx.clickIncome` assertions change shape
  (number → layers); the `computeClickIncome` ones change value wherever a debuff
  and an own-multiplier are both present.
- [shared/tests/click.test.ts](../../shared/tests/click.test.ts) covers the idler
  click branch end to end; the `sc-mf-cp` + `sc-pcps` combination changes value.
- [shared/tests/effects.test.ts:1452-1461](../../shared/tests/effects.test.ts#L1452-L1461)
  asserts `sc-pcps`'s emitted modifier with `toContainEqual` — order-insensitive,
  survives as-is (the emitted list is unchanged; only its consumption differs).
- [client/tests/click-debuff.dom.test.ts](../../client/tests/click-debuff.dom.test.ts)
  pins the per-stage rows and the `Per click` values they sit next to; the income
  figures change, the row values (`-2`, `×0.5`) do not.
- [server/tests/match.test.ts:350](../../server/tests/match.test.ts#L350),
  [:409](../../server/tests/match.test.ts#L409) drive `enemyProductionModifier`
  through a real match.
- **New:** the property the whole plan buys — a test asserting click income is
  **invariant under shuffling** the modifier array. That is the regression that
  would have caught this in the first place, and it belongs on the resource track
  too.

---

## Open questions

1. **Option 2 or 3** — consistency with resources, or "a flat debuff means a flat
   number"? Everything else in this plan is the same either way.
2. **Fix `sc-pcps` as part of this, or separately?** The layering fixes it as a
   side effect. If that balance shift is unwanted right now, the alternative is to
   land the incoming/own split only and keep own modifiers sequential — but that
   leaves half the order-sensitivity in place, so it is not recommended.
3. **Does anything else ride an un-layered track?** `clickIncome` is the only one
   today ([pipeline.ts:58](../../shared/src/modifiers/pipeline.ts#L58)). Any future
   standalone track should be layered from the start.
