# 33 — Enemy cost inflation: a passive attack that raises the victim's prices

## Status: Implemented

Sections below are the plan as built; where the implementation departed from the
draft, the change and its reason are marked inline. Nothing is authored on the
idler tree — this is the mechanic, its reporting, and its tests.

---

## Goal

A new family of **passive attacks that make the opponent's purchases more
expensive** — upgrades, generators, or one named entity — for as long as the
attack is unlocked. The third offensive lever after production debuffs
(`enemyProductionModifier`) and one-shot theft (`stealResource` /
`stealGenerator`), and the first that attacks the _economy_ rather than the
income curve: it doesn't slow what you earn, it raises what you have to earn.

Ship the **mechanic + editor form + tests**; author nothing on
[idler.json](../../shared/trees/idler.json), matching what both prior debuff
commits did.

---

## What already exists (verified)

- **Offensive effect plumbing.** `enemyProductionModifier`
  ([seed/enemy-production-modifier.ts](../../shared/src/effects/seed/enemy-production-modifier.ts))
  declares `hosts: ['passiveAttack']` and emits an `EnemyModifierOutput`
  ([effects/types.ts:132](../../shared/src/effects/types.ts#L132)).
  [`collectEnemyDebuffs`](../../shared/src/modes/index.ts#L1075) walks the
  attacker's _unlocked passive_ attacks and gathers those outputs; the wire
  carries them as `debuffs?: Modifier[]`
  ([messages.ts:207](../../shared/src/messages.ts#L207)) and each side runs
  [`resolveEnemyDebuffs`](../../shared/src/modes/index.ts#L1121) before feeding a
  pipeline. Host placement is enforced generically at
  [modes/index.ts:308-328](../../shared/src/modes/index.ts#L308-L328), and the
  authored `field` against a per-mode catalog at
  [modes/index.ts:338-361](../../shared/src/modes/index.ts#L338-L361).
- **A friendly cost-reduction effect already exists.** `generatorCost`
  ([seed/generator-cost.ts](../../shared/src/effects/seed/generator-cost.ts))
  emits `GeneratorCostOutput { costFactor?, scalingFactor? }`
  ([effects/types.ts:19](../../shared/src/effects/types.ts#L19)), aggregated by
  [`collectGeneratorCostFactors`](../../shared/src/generators.ts#L46) and applied
  by [`applyGeneratorCostFactors`](../../shared/src/generators.ts#L76). Its
  schema is `z.number().positive()`, so a factor **above 1 is already legal** —
  the arithmetic for "more expensive" is built and tested; only the _source_
  (an opponent) and the _upgrade_ scope are missing.
- **Generators have a cost-resolution seam.**
  [`resolveGeneratorDef(def, state, mode)`](../../shared/src/generators.ts#L103)
  is called at every generator price site — validation
  ([purchase-validation.ts:81](../../shared/src/purchase-validation.ts#L81)),
  purchase/sell ([generators.ts:233](../../shared/src/generators.ts#L233),
  [:158](../../shared/src/generators.ts#L158)), the bot
  ([bot.ts:250](../../server/src/bot.ts#L250)), the client's prediction and
  reconcile ([game.ts:517](../../client/src/game.ts#L517),
  [:532](../../client/src/game.ts#L532),
  [:750](../../client/src/game.ts#L750)), and the panel
  ([generators-panel.ts:120](../../client/src/ui/panels/generators-panel.ts#L120)).
- **Upgrades have no seam at all.**
  [`getUpgradeNextCost(def, currentLevel)`](../../shared/src/upgrade-costs.ts#L5)
  is called directly from seven places across all three packages
  ([purchase-validation.ts:49](../../shared/src/purchase-validation.ts#L49),
  [modes/index.ts:1172](../../shared/src/modes/index.ts#L1172),
  [bot.ts:232](../../server/src/bot.ts#L232),
  [game.ts:496](../../client/src/game.ts#L496),
  [game.ts:725](../../client/src/game.ts#L725),
  [components.ts:178](../../client/src/ui/components.ts#L178),
  [upgrade-detail.ts:57](../../client/src/ui/upgrade-detail.ts#L57),
  [helpers.ts:85](../../client/src/ui/helpers.ts#L85)) plus the bulk/max-affordable
  helpers in the same file.
- **`PlayerState`** ([types.ts:162](../../shared/src/types.ts#L162)) is a flat,
  wire-stable object with an untyped `meta: Record<string, unknown>` for
  mode-specific scratch. `pendingAttacks`
  ([types.ts:171-188](../../shared/src/types.ts#L171-L188)) is the precedent for
  a **first-class** field, and its doc states the test: "engine-level,
  wire-stable, reasoned about during reconciliation."
- **`OpponentView`** ([messages.ts:166](../../shared/src/messages.ts#L166)) is
  built field-by-field, so a new `PlayerState` field leaks no intel by default.
- **Sell refund** is 50% (`GENERATOR_SELL_REFUND_RATE`
  in [game-config.ts:42](../../shared/src/game-config.ts#L42)), priced off the
  _cost-adjusted_ definition
  ([generators.ts:136](../../shared/src/generators.ts#L136)).

---

## Approach

### 1. The effect and its output (symmetric with what's there)

New seed effect `enemyCostModifier`, registered in
[effects/index.ts](../../shared/src/effects/index.ts), `hosts: ['passiveAttack']`:

```ts
const schema = z
  .strictObject({
    /** `upgrades` / `generators`, or `upgrade:<id>` / `generator:<id>`. */
    target: z.string(),
    /** Multiplies the base cost. `1.25` = 25% dearer. */
    costFactor: z.number().gt(1).optional(),
    /** Multiplies the growth portion of the cost curve. */
    scalingFactor: z.number().gt(1).optional(),
  })
  .refine((p) => p.costFactor !== undefined || p.scalingFactor !== undefined)
```

**Changed during implementation:** the draft authored a `scope` enum plus an
optional `id`. That pair can disagree (scope `upgrade`, a generator's id), and
`effectFieldOptions` can't narrow one field by another's current value — so the
`/dev.html` picker would have had to offer every id under both scopes and let the
boot-time validator catch the mismatch, in a tool whose whole purpose is making
invalid data unauthorable. A single namespaced key makes the inconsistent
combination _unrepresentable_, and it follows the existing catalog convention
(`accessEnemyData`'s `data`, `relativeModifier`'s `source`). `parseEnemyCostTarget`
splits it into the structural `{ scope, id? }` the price paths consume; the
authored form and the runtime form differ deliberately.

`apply` is state-independent and echoes the authored inflation as a **new output
kind**, added to the `EffectOutput` union
([effects/types.ts:288](../../shared/src/effects/types.ts#L288)):

```ts
export interface EnemyCostOutput {
  readonly kind: 'enemyCost'
  readonly scope: CostScope // 'upgrade' | 'generator', split from `target`
  readonly id?: string // absent = every entity of that scope
  readonly costFactor?: number
  readonly scalingFactor?: number
}
```

**Not** an `EnemyModifierOutput`. A price is not a pipeline field: routed through
`Modifier` it would be swept into `collectModifiers` / `computePassiveRates` and
either do nothing or silently debuff production. The distinct `kind` is what
keeps it off the wrong subsystem — the same argument the `enemyModifier` kind
already makes for itself.

`gt(1)` rather than `positive()`: on a _friendly_ upgrade a factor below 1 is
the whole point, but on an attack it would gift the victim a discount, which is
never intended authoring, and exactly 1 would be a no-op. (`guardModifierValue`
is the precedent for guarding a value's sign/range in an effect schema.)

New collector beside `collectEnemyDebuffs`, same walk:

```ts
export function collectEnemyCostFactors(
  attacker: Readonly<PlayerState>,
  mode: ModeDefinition,
): EnemyCostFactor[]
```

No owned-count compounding — an attack is unlocked or it isn't. Multiple
inflations stack multiplicatively, exactly as `collectGeneratorCostFactors`
stacks friendly ones.

`validateModeDefinition` gains one loop next to the existing
`enemyProductionModifier` field check: the authored `target` must be a key in
`enemyCostTargets(mode)`, so a typo — or an id that no longer exists, or a
generator's id under the upgrade prefix — refuses to boot rather than producing
an attack that does nothing.

### 2. Getting it to the price paths (the actual work)

Production debuffs are easy because rates are recomputed each tick from a
modifier list the caller assembles. Prices are the opposite: they're read by a
dozen leaf functions that take `(def, owned)` or `(state, mode)` and have no
notion that an opponent exists. Two options, and the choice matters more than
the effect design:

|              | **A — thread a parameter everywhere**                                                                                                          | **B — carry it on the victim's `PlayerState`**            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Churn        | ~15 signatures across 3 packages                                                                                                               | one field + two resolver seams                            |
| Failure mode | a site that forgets it prices at base → **client predicts one price, server validates another** → rejected purchase, flickering optimistic buy | client and server read the same field off the same object |
| Wire         | reuse `debuffs`-style side channel                                                                                                             | one new `PlayerState` field, already broadcast whole      |

**Decision: B.** The client re-applies its local buy actions on top of the
server snapshot during reconciliation
([game.ts:725-752](../../client/src/game.ts#L725-L752)); a state-carried factor
is therefore automatically the _same_ factor on both sides, which is the one
property this feature cannot afford to get wrong.

Shape it as a flat array, mirroring how `debuffs` is a flat `Modifier[]` rather
than a pre-aggregated structure:

```ts
// PlayerState — first-class, not in `meta` (reasoned about during reconciliation)
/**
 * Cost inflation the opponent's unlocked passive attacks currently inflict on
 * this player. Absent when none are active. Affects only *future* purchases.
 */
readonly incomingCostFactors?: readonly EnemyCostFactor[]
```

The server stamps it from `collectEnemyCostFactors(opponent)` via one small
`syncIncomingCostFactors(player, opponent)` helper, called at the top of
[`processActions`](../../server/src/match.ts#L414) (and the bot's action loop)
and once per tick before [`broadcastState`](../../server/src/match.ts#L679).
Stamping at action time matters: actions are processed on message receipt
([match.ts:276](../../server/src/match.ts#L276)), not inside the tick, so a
tick-only stamp would validate purchases against a factor up to one tick stale.
Restamping there costs a walk over a handful of attack defs.

The client needs no new wire field and no local recomputation — the factor
arrives inside `player` on every `STATE_UPDATE` and only ever changes when the
opponent unlocks the attack. `OpponentView` deliberately does **not** carry it
(it's built field-by-field, so this is the default).

### 3. The two seams

Extract the cost-curve arithmetic that already exists at
[generators.ts:83-94](../../shared/src/generators.ts#L83-L94) into `cost.ts`:

```ts
export function applyCostFactors(entry: CostEntry, factors: CostFactors): CostEntry
```

`applyGeneratorCostFactors` then delegates to it, and the upgrade side reuses it
per currency instead of duplicating the linear/exponential branch. Both scopes
get both knobs for less code than special-casing upgrades to base-cost only.

- **Generators**: fold the incoming factors into `collectGeneratorCostFactors`
  (it already takes `state`, which now carries them). Multiply them in _after_
  the friendly factors, so a reduction and an inflation compose commutatively.
  **Zero call-site churn** — all eight sites already go through
  `resolveGeneratorDef`.
- **Upgrades**: add the missing seam. Give `getUpgradeNextCost` a **required**
  third parameter:

  ```ts
  getUpgradeNextCost(def: UpgradeDefinition, currentLevel: number, factors: CostFactors)
  ```

  Required, not optional, on purpose: the compiler then finds all seven call
  sites, and there is no way to silently price at base. Sites with a player state
  build it with the new `upgradeCostFactors(state, upgradeId)` seam (which wraps
  `incomingCostFactors(state, 'upgrade', id)` and is where a future friendly
  upgrade-cost reduction would compose);
  the dev simulator and `balance/metrics.ts` — which have no opponent — pass the
  exported `NEUTRAL_COST_FACTORS`, which reads as a deliberate "no opponent
  here" rather than an omission. `getUpgradeBulkCost`,
  `getMaxAffordableUpgradeLevels` and `getUpgradeCostTotal` take it through the
  same way.

Rounding stays exactly where it is — `Math.round` for upgrades
([upgrade-costs.ts:11](../../shared/src/upgrade-costs.ts#L11)), `Math.floor` for
generators ([generators.ts:114](../../shared/src/generators.ts#L114)). The factor
applies to the curve _before_ the existing rounding, once, so both sides land on
the same integer.

### 4. Sell refund must ignore incoming inflation

[`getGeneratorSellRefund`](../../shared/src/generators.ts#L136) prices the copy
being removed off the **cost-adjusted** definition, at 50%. If enemy inflation
flowed through the same resolver, a ×2 attack would refund more than the victim
paid — the attack becomes a gift, and a strong one turns into a sell/rebuy money
pump.

So the resolver cannot collapse own and incoming factors into a single
`GeneratorCostFactors`. `resolveGeneratorDef` grows a purpose flag — buying
resolves own × incoming, selling resolves own only:

```ts
resolveGeneratorDef(def, state, mode, purpose: 'buy' | 'sell' = 'buy')
```

`applyGeneratorSell` ([generators.ts:158](../../shared/src/generators.ts#L158))
is the one `'sell'` caller. The refund therefore stays pinned to the victim's own
economy, which is also the intuitive reading: the enemy inflates what you _pay_,
not what your assets are worth.

### 5. Victim-facing reporting

Follow the highlight-debuff precedent from `e95b785`:

- **Enemy data panel** — a standing, deliberately ungated warning whenever
  inflation is present ("Upgrades cost +25%"), shown with no espionage
  researched. Percentage only, to match how `highlightDebuffFactor` is rendered
  in [espionage-panel.ts:61](../../client/src/ui/panels/espionage-panel.ts#L61).
- **Cards** — the tree node and the detail popup computed the same cost label
  from duplicated code; both now call one `formatUpgradeCost(state, u, flavor)`
  helper in [helpers.ts](../../client/src/ui/helpers.ts), which prices with the
  factors in force and appends `INFLATED_COST_MARKER` (⬆) so a price above the
  tree's authored number doesn't read as a tree bug. The generator card takes an
  `inflated` display flag and marks its buy button the same way.
- **Found while implementing: the generator panel's refund was wrong.** It
  priced `sellRefund` off the same `'buy'`-resolved definition as the buy button,
  so the refund _shown_ would have included enemy inflation while
  `applyGeneratorSell` credited the uninflated amount. The panel now resolves a
  separate `'sell'` definition for that figure — the display bug is the same
  mistake §4 guards against in the engine, one layer up.
- **Buy-max** — [`getMaxAffordableGeneratorCount`](../../shared/src/generators.ts#L168)
  and `getMaxAffordableUpgradeLevels` inherit the inflated curve through the same
  seam. Not cosmetic: a bulk buy priced at base would be rejected wholesale by
  the server.

### 6. Dev editor

[`effects-editor.ts`](../../client/src/dev/editor/effects-editor.ts) generates
the param form from the zod schema, so `costFactor`/`scalingFactor` come free.
An `enemyCostTargetsFor(upgradeIds, generatorIds)` catalog in
[addressable.ts](../../shared/src/effects/addressable.ts) — beside
`enemyDebuffTargetsFor` — makes `target` a labelled dropdown (the two whole-scope
entries plus one per upgrade and generator) rather than free text, sharing one
source of truth with the validator. The effect joins the picker's `Offense`
group; the attacks view
([dev/editor/views/attacks.ts](../../client/src/dev/editor/views/attacks.ts))
needs no change, since the picker already filters by declared host.

---

## Files touched

| File                                                           | Change                                                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/effects/seed/enemy-cost-modifier.ts`               | **New** — schema + `apply`, `hosts: ['passiveAttack']`.                                                                          |
| `shared/src/effects/index.ts`                                  | Register `enemyCostModifier`.                                                                                                    |
| `shared/src/effects/types.ts`                                  | Add `EnemyCostOutput` + union member + routing docs.                                                                             |
| `shared/src/effects/addressable.ts`                            | Add `enemyCostTargetsFor` / `enemyCostTargets` / `parseEnemyCostTarget` (editor + validator catalog).                            |
| `shared/src/types.ts`                                          | Add `PlayerState.incomingCostFactors` + `EnemyCostFactor`.                                                                       |
| `shared/src/cost.ts`                                           | `CostFactors` / `NEUTRAL_COST_FACTORS`, extracted `applyCostFactors`, `combineCostFactors`, `incomingCostFactors`.               |
| `shared/src/generators.ts`                                     | Fold incoming factors into `collectGeneratorCostFactors`; `resolveGeneratorDef` gains `purpose`; delegate to `applyCostFactors`. |
| `shared/src/upgrade-costs.ts`                                  | Required `factors` param on the four cost helpers; new `upgradeCostFactors` seam.                                                |
| `shared/src/modes/index.ts`                                    | `collectEnemyCostFactors`; validate `target` in `validateModeDefinition`; `applyPurchase` passes factors.                        |
| `shared/src/purchase-validation.ts`                            | Pass factors on both the upgrade and generator paths.                                                                            |
| `server/src/match.ts`                                          | `syncCostFactors` stamp at `processActions`, `processBotActions`, and `broadcastState`.                                          |
| `server/src/bot.ts`                                            | Pass factors at the upgrade cost site (the generator site already resolves).                                                     |
| `client/src/game.ts`                                           | Pass factors in prediction + reconcile; carry the field through `clonePlayerState`.                                              |
| `client/src/ui/{components,upgrade-detail,helpers,hotkeys}.ts` | Pass factors (compiler-driven sweep).                                                                                            |
| `client/src/ui/panels/{generators,espionage}-panel.ts`         | Inflated buy price + marker, uninflated refund, standing inflation warning.                                                      |
| `client/src/dev/{strategies,editor/effects-editor}.ts`         | `NEUTRAL_COST_FACTORS` in the single-player planner; `target` picker in the editor.                                              |

## Data / type changes

- **`PlayerState.incomingCostFactors?: readonly EnemyCostFactor[]`** — one new
  wire-stable field, server-stamped, absent when no inflation is active. Old
  clients ignore it; a state without it prices at base.
- **No new `STATE_UPDATE` field.** Unlike `debuffs`, this needs no unresolved
  form on the wire: there's no victim-side ambiguity to preserve (no virtual
  target like `highlightFactor`), and resolving server-side is exactly what keeps
  the two sides' integers identical.
- **New effect output kind** `enemyCost`; every existing consumer ignores it by
  construction.
- **`getUpgradeNextCost` and friends change signature** (required param). Source
  compatible with nothing outside this repo.
- **`GeneratorCostFactors` is gone**, replaced by the shared `CostFactors` in
  `cost.ts` — same shape, one name, and `applyGeneratorCostFactors` now delegates
  the linear/exponential branch to `applyCostFactors` instead of owning it.
- **`balance/metrics.ts` needed no change**: it reads `scaledCost` directly
  rather than going through the upgrade cost helpers.

## Complexity check

- **One new effect, one new output kind, one new collector** — each the exact
  twin of something that already exists (`generatorCost`, `GeneratorCostOutput`,
  `collectEnemyDebuffs`). No new subsystem.
- **One new `PlayerState` field.** Justified by the desync argument in §2;
  `pendingAttacks` sets the precedent for engine-level state that reconciliation
  reasons about. Deliberately _not_ in `meta`, which is untyped mode scratch.
- **`applyCostFactors` extraction** is net-negative code: the linear/exponential
  branch stops being generator-specific instead of being copied for upgrades.
- **`resolveGeneratorDef`'s `purpose` flag** is the one genuinely new concept —
  the price you pay and the price you're refunded stop being the same number.
  It buys out a real exploit (§4), and defaults to `'buy'` so the eight existing
  callers read unchanged.
- **`bot.ts` (decided: fix it).** Unlike `e95b785`'s battery planning (left
  reading the undebuffed figure), ignoring the factor here makes the bot **buy at
  prices the server would reject** — a correctness bug, not a planning
  inaccuracy. In the end only its upgrade site needed touching: its generator
  planning already goes through `resolveGeneratorDef`, which is the payoff of
  putting the factors on state.
- **Deliberately NOT built:** inflation on active attacks (one-shot price
  spikes), decaying/timed inflation, inflation on attack `prepareCost`,
  per-currency targeting, and any authoring on the idler tree. Each is additive
  later.

## Tests (as landed)

- **`shared/tests/effects.test.ts`** — `target` splits into scope + id for both
  forms; a factor below 1 (a gift) and a factor-less ref are rejected; an
  unparseable target is inert rather than emitting an output naming nothing.
- **`shared/tests/flavor.test.ts`** — `validateModeDefinition` throws on an
  unknown target, on a generator's id under the `upgrade:` prefix, and on the
  effect placed on an active attack; accepts a declared upgrade.
- **`shared/tests/cost-inflation.test.ts` (new, 20 tests)** — the suite that
  actually protects the feature:
  - `collectEnemyCostFactors` gathers only from unlocked _passive_ attacks, and
    an extra level of the gating upgrade does not compound the inflation;
  - `incomingCostFactors` compounds whole-scope with entity-specific entries and
    keeps the two scopes apart;
  - **validated price === charged price**: affordability flips at exactly the
    inflated integer (124 blocked / 125 allowed) and `applyPurchase` deducts that
    same number, for upgrades and generators, base-cost and curve inflation,
    plus buy-max counting copies at the inflated price;
  - the sell refund stays uninflated, a buy-then-sell round trip is strictly
    lossy, and a friendly reduction still lowers the refund;
  - a friendly ×0.5 and an enemy ×2 compose back to the authored price, and a
    whole-scope inflation reaches a generator with no own factors.
- **`server/tests/match.test.ts`** — the stamp lands on the victim's broadcast
  state and is absent for the attacker and for an unattacked pair; a buy the
  victim can afford at the authored price is rejected, then succeeds once the
  inflated price is covered.
- **`client/tests/cost-inflation.test.ts` (new, node tier — every assertion is on
  a returned string)** — the upgrade label quotes the inflated price with the ⬆
  marker and shades affordability to match; the generator card quotes the
  inflated buy price while refunding the authored one; the enemy-data panel warns
  ungated, names a single-entity target by flavor name, and reports base-price
  and growth inflation as separate lines.
- Full suite green: shared 644, server 156, client 410. `pnpm typecheck`,
  `format:check`, `lint`, `lint:css` all pass. **The e2e suite could not run
  here** — Playwright's browsers aren't installed in this environment
  (`browserType.launch: Executable doesn't exist`), which is unrelated to this
  change; no e2e spec asserts on the cost strings this touches, and with no
  attack authored the rendered output is byte-identical to before.

## Decisions (resolved)

1. **Output kind** → new `enemyCost`, not `enemyModifier`. A price isn't a
   pipeline field.
2. **Transport** → state-carried on `PlayerState`, server-stamped, resolved
   server-side. Not a new `STATE_UPDATE` field, not a threaded parameter.
3. **Upgrade seam** → required `factors` param on `getUpgradeNextCost` so the
   compiler enumerates every call site.
4. **Sell refund** → prices at the victim's own factors only; `resolveGeneratorDef`
   gains a `purpose` flag.
5. **Value range** → `> 1` on an attack (no accidental gifts or no-ops); the
   friendly `generatorCost` keeps `positive()`.
6. **Bot** → fixed, unlike the battery precedent: ignoring inflation would make
   it attempt purchases the server rejects.
7. **Authoring** → mechanic only; nothing on `idler.json` this plan.

---

## Outcome

§1–§6 all landed on `feat/4-enemy-cost-inflation` as one change: the effect, the
state-carried transport, the two seams, the sell-refund rule, the reporting, and
the editor catalog. Splitting §1–§4 was never really an option — any subset
leaves two prices disagreeing somewhere.

The heaviest cost to the next dev is the `getUpgradeNextCost` signature sweep and
the `purpose` flag on `resolveGeneratorDef`. Both earn it: upgrades having no
cost-resolution seam is the reason `generatorCost` never got an upgrade twin, so
this pays down that gap as a side effect — a friendly `upgradeCost` reduction
effect is now a ten-line follow-up that composes inside `upgradeCostFactors`.

**Next step (deliberately not in this branch):** author an attack on
[idler.json](../../shared/trees/idler.json) — an `unlockAttack` upgrade plus a
passive attack carrying, say
`{ "type": "enemyCostModifier", "target": "upgrades", "costFactor": 1.15 }`, with
its `AttackFlavor` entry. That's a balance decision, and the mechanic is ready
for it.
