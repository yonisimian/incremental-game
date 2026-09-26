# 42 — Passive pacts: opponent-derived buffs through a treaty

## Status: Implemented (branch `feat/10-passive-pacts`)

### As built — departures from the text below

- **`collectPactBonuses` takes one snapshot, not two.** Every pact in force
  resolves against the _partner_: an owner-held pact reads the enemy by
  definition, and a partner-held mutual pact benefits the owner by reading its
  holder — who is, from the owner's side, the enemy. So the signature is
  `(owner: PlayerState, partner: PartnerSnapshot, mode)` and the server calls it
  once per player with the roles swapped. `pactsInForce` lists a pact both
  players signed **once** — "the enemy gains the same from yours" is one treaty,
  not a doubled one.
- **One stamped read.** `cost.ts` folds both stamped lists through a private
  `foldStampedFactors`, and `stampedCostFactors` composes the enemy inflation
  with the pact discount; `upgradeCostFactors` and the generator `'buy'` map
  both go through it, so neither can forget a list.
- **The price marker points both ways.** A discounted price is marked `⬇`
  (`DISCOUNTED_COST_MARKER`); an item both inflated and discounted stays `⬆`
  — the enemy's mark is the one the player needs explained. The generator card
  carries the marker string (`costMarker`) instead of an `inflated` flag.
- **`collectRawModifiers` routes a raw modifier by the absence of a `kind`.**
  `mirrorModifier` is the first kinded output that also carries a `stage`, so
  the old `'stage' in o` test would have routed a pact rule into the owner's
  pipeline. Nothing walks pact effects there, but the type no longer allows the
  mistake.
- **A resource may not be named `score`** — the enemy-stat key, refused at boot
  like the intel keys.
- **The data panel's totals include the pact bonuses**, the click-debuff rows
  do not (they report what the enemy is _taking_). All client income paths go
  through one `externalModifiers` seam in `game.ts`.
- **The toast is in** (open question 4): `🤝 🪵 Trade route signed by the
enemy`, `info`, on a mutual pact's first appearance in `opponent.pacts`.
- **The relations panel test is node tier**, not the DOM tier §Tests named:
  `render` is string markup, per the test-tier rule.
- **The editor model cascade landed in stage 7, not 8**, because the authored
  tree stopped loading after any rename in the editor tests: pact effects join
  `allEffectRefs`, a `mirrorStatModifier`'s resource `source`/`field` follow a
  resource rename, and the `upgrade:<id>` / `generator:<id>` keys of _both_
  cost effects and the pact mirror follow generator and node renames (a
  removed node drops the refs that named it). `entityCostTargetKey` is the new
  exported inverse of `parsePurchaseTarget` for a single-entity key. The picker group and the three
  dropdowns landed with their effects in stages 3–4 (the grouping and
  every-string-param-has-a-picker tests require it).
- **The bot signs generically** — the unlock node of every passive pact with
  effects, found through `unlockPact` refs, not the three hard-coded ids.
- **Open questions 1–3** shipped as proposed: per-entity discount, `:rate`
  sources kept, `cap` bounds the bonus (the added amount, or the excess over 1).

Full suite green: shared 898, server 182, client 533. `typecheck`, `lint`,
`lint:css`, `lint:exports`, `format:check`, `check:balance` and
`lint:instructions` all pass. Main client bundle 30.65 kB raw (budget 60/80).

First of three pact plans. This one ships **passive pacts** end to end —
mechanic, validation, editor, panel, idler authoring, tests. The two that follow
are design-only for now and build on the seams laid here:

- [43 — Cooldowns](43-activation-cooldowns.md): a `cooldownSec` after an active
  attack's or pact's effect ends, before it can be activated again.
- [44 — Active pacts](44-active-pacts.md): the activate → window → cooldown
  lifecycle for the `active` pact kind.

Proposed decisions (2026-09-19), open for veto before stage 1 lands:

- **Effects stay pure and single-player.** No `apply` signature change. Pact
  effects _describe_ a buff (like `enemyProductionModifier` describes a debuff);
  a resolver that holds both players' states turns the description into
  concrete numbers. Only the server has both states, so it resolves and ships
  results (§3).
- **Two effects**, matching the two examples this plan was asked for:
  `mirrorCostModifier` (an item the enemy already bought is cheaper for you) and
  `mirrorStatModifier` (a bonus scaled by one enemy stat) (§4, §5).
- **A pact may be `mutual`.** A mutual pact's effects also resolve for the
  partner, reading the owner as _their_ enemy. Off by default (§6).
- **Discounts ride the stamping pattern, bonuses ride the debuff channel.**
  Cost factors are stamped on `PlayerState` (prices must agree byte for byte);
  production bonuses go out resolved on `STATE_UPDATE` like `debuffs` do (§7,
  §8).
- **Enemy rates are read pact-free.** A `:rate` source reads the partner's rate
  _before_ their own pact bonuses, so two rate-mirroring pacts cannot feed each
  other (§8).
- **The price tag may leak.** A discount appearing on an upgrade tells the
  player the enemy owns it. Accepted as the pact's flavor; the tree can gate the
  pact node behind purchase intel if that ever feels wrong (§12).

---

## Goal

Attacks are done: a player can debuff, tax, embargo and rob the enemy. Pacts are
the other half of the relations panel — a treaty that **benefits** you because
of the enemy, or benefits you both. The four authored pacts (`p0`–`p3`) unlock,
render as disabled buttons, and do nothing; every comment on the pact surface
says "no behavior yet".

This plan gives the two `passive` pacts behavior:

- **Shared research** — an upgrade (or generator) the enemy has already bought is
  cheaper for you, for as long as they are ahead of you on it.
- **Trade route** — a production bonus scaled by an enemy stat (their woodcutter
  count, their wood rate, their peak CPS…), capped, optionally mutual.

Ship **mechanic + validation + editor + panel + idler authoring + tests**, in
stages that each land as one commit (see
[Implementation stages](#implementation-stages)). Active pacts are **not**
touched: `p0`/`p1` stay placeholders, and nothing here blocks plan 44.

---

## What already exists (verified)

- **The pact shell.** `PactDefinition` is `{ id, kind }`
  ([types.ts](../../shared/src/types.ts#L179)); `PactSchema` mirrors it
  ([tree/schema.ts](../../shared/src/tree/schema.ts#L104)); `PactFlavorSchema`
  carries name / icon / description. `unlockPact`
  ([unlock-pact.ts](../../shared/src/effects/seed/unlock-pact.ts)) emits
  `pactUnlock`, consumed by `isPactUnlocked` / `unlockedPacts`
  ([modes/index.ts](../../shared/src/modes/index.ts#L926)). Boot validation
  checks flavor coverage and `unlockPact` targets. The panel
  ([international-relationship-panel.ts](../../client/src/ui/panels/international-relationship-panel.ts))
  lists unlocked pacts by kind and ends with "Pacts don't do anything yet."
- **The idler authors four pacts and five free nodes.** `p0`/`p1` active,
  `p2`/`p3` passive ([idler.json](../../shared/trees/idler.json#L327));
  `ir-unlock` opens the panel and `pact-node`…`pact-node-4` each unlock one
  pact, all `cost: {}`, all gated on `ir-unlock` only.
- **Effects declare where they may live.** `EffectHost` is
  `'mode' | 'upgrade' | 'passiveAttack' | 'activeAttack'`
  ([effects/types.ts](../../shared/src/effects/types.ts#L428));
  `DEFAULT_EFFECT_HOSTS` / `isEffectAllowedOn`
  ([registry.ts](../../shared/src/effects/registry.ts#L47)) are enforced at
  boot. A pact host is one more union member plus one more placement loop.
- **Effects never see the opponent.** `apply(params, state, mode)` receives one
  `PlayerState`; the only opponent-derived data on it is what the server stamps
  (`incomingCostFactors`, `incomingPurchaseLocks`, `meta.attacksSuffered`). The
  cross-player step lives in the server — `syncCostFactors`
  ([match.ts](../../server/src/match.ts#L434)) and the tick
  ([match.ts](../../server/src/match.ts#L539)) — and in the one shared function
  that takes both states, `resolveAttackStrike`.
- **The upgrade-cost seam is waiting.** `upgradeCostFactors`
  ([upgrade-costs.ts](../../shared/src/upgrade-costs.ts#L5)) is documented as
  the place a friendly reduction "would compose"; `collectGeneratorCostFactors`
  ([generators.ts](../../shared/src/generators.ts#L58)) already composes own
  reductions with incoming inflation for `purpose: 'buy'`. `incomingCostFactors`
  ([cost.ts](../../shared/src/cost.ts#L101)) folds a list of
  `{ scope, id?, costFactor?, scalingFactor? }` entries multiplicatively — a
  discount is the same entry with a factor below `1`.
- **Resolved modifiers already travel the wire.** `StateUpdateMessage.debuffs`
  ([messages.ts](../../shared/src/messages.ts#L252)) carries unresolved enemy
  modifiers; the client merges them into its rate and click income
  ([game.ts](../../client/src/game.ts#L973)) through `resolveEnemyDebuffs`, which
  turns the virtual `highlightFactor` target into a real resource modifier.
- **The server already computes opponent rates.** `opponentViewFor`
  ([match.ts](../../server/src/match.ts#L811)) runs `computePassiveRates` over
  the opponent's modifiers plus the viewer's debuffs. The same figure is what a
  `:rate` source should read.
- **A stat vocabulary exists.** `accessEnemyData` keys
  ([access-enemy-data.ts](../../shared/src/effects/seed/access-enemy-data.ts))
  name `r0`, `r0:rate`, `peakCps`, `purchases`; `enemyCostTargets`
  ([addressable.ts](../../shared/src/effects/addressable.ts#L177)) names
  `upgrades` / `generators` / `upgrade:<id>` / `generator:<id>`;
  `enemyDebuffTargets` names what a modifier may hit from outside the pipeline.
  Pact effects reuse all three rather than inventing a fourth spelling.
- **Value guards are direction-aware.** `guardModifierValue(intent, name)`
  ([value-guard.ts](../../shared/src/modifiers/value-guard.ts)) takes
  `'bonus' | 'debuff'`; only `'debuff'` has a caller today.
- **The editor has no pact section.** `views/attacks.ts` authors attacks (kind,
  cost, timing, effects); pacts are hand-edited JSON, and `effects-editor.ts`
  knows them only as the `unlockPact` dropdown source
  ([effects-editor.ts](../../client/src/dev/editor/effects-editor.ts#L191)). The
  effect picker groups are a static table
  ([effects-editor.ts](../../client/src/dev/editor/effects-editor.ts#L545)) and a
  test requires every registered effect to be grouped.
- **Plans 26, 29, 31 all defer to "when pacts have behavior".** Toasts for pact
  start/finish, e2e coverage, and the "shield pact" idea are waiting on this.

---

## Approach

### 1. `PactDefinition` gains `effects` and `mutual`

```ts
// shared/src/types.ts
export interface PactDefinition {
  readonly id: string
  readonly kind: PactKind
  /**
   * Whether the pact's effects also resolve for the partner, reading the owner
   * as *their* enemy. A one-sided pact benefits its owner only. Default false.
   */
  readonly mutual?: boolean
  /**
   * The buffs this pact carries. On a passive pact each `mirrorCost`-emitting
   * effect applies to the owner's prices and each `mirrorModifier`-emitting one
   * to the owner's production, continuously while unlocked (and, if `mutual`,
   * to the partner's too). Optional — an effect-less pact is a placeholder.
   */
  readonly effects?: readonly EffectRef[]
}
```

`PactSchema` grows the two optional fields. The active-only fields
(`activationCost`, `durationSec`, `cooldownSec`) are specified in plans 43/44
and **not** added here, so a passive pact declaring one is a schema error, not
a boot rule.

### 2. Two new hosts: `passivePact` / `activePact`

```ts
export type EffectHost =
  'mode' | 'upgrade' | 'passiveAttack' | 'activeAttack' | 'passivePact' | 'activePact'
```

The host-name record in `modes/index.ts` (the one ending `activeAttack: 'an
active attack'`) gains `passivePact: 'a passive pact'` and `activePact: 'an
active pact'`, and the placement loop that walks `def.attacks` gains a twin
over `def.pacts`. Both new effects declare `hosts: ['passivePact', 'activePact']`
— plan 44 reads the `activePact` half, nothing reads it until then, which is
exactly the situation `enemyPurchaseLock` was in before its collector existed.

Nothing else may live on a pact: `baseModifier` on a pact is a placement error
(a pact that doesn't involve the enemy is an upgrade), and the offensive
effects are attack-only by their own declarations.

### 3. Why the effects stay pure

The obvious alternative is `apply(params, state, mode, opponent?)`. Rejected:

- Every existing effect, collector and test would gain an optional argument it
  never reads.
- The client cannot supply it — the opponent's `upgrades` and `generators` are
  deliberately never sent. An effect that only works server-side breaks the
  "shared code, both sides agree" contract every price and rate path relies on.
- Attacks solved the same problem already: `enemyProductionModifier` echoes its
  params, and `collectEnemyDebuffs` (attacker) + `resolveEnemyDebuffs` (victim)
  do the cross-player work. Pacts follow suit with one resolver module.

So pact effects **echo** their params as a kinded output, and
`shared/src/pacts.ts` (§6) resolves them against a `PartnerSnapshot` the server
assembles.

### 4. Effect `mirrorCostModifier` → output `mirrorCost`

```ts
// shared/src/effects/seed/mirror-cost-modifier.ts
const schema = z
  .strictObject({
    /** `upgrades` | `generators` | `upgrade:<id>` | `generator:<id>` — the enemy-cost target vocabulary. */
    target: z.string(),
    costFactor: z.number().positive().lt(1).optional(),
    scalingFactor: z.number().positive().lt(1).optional(),
  })
  .refine((p) => p.costFactor !== undefined || p.scalingFactor !== undefined, {
    message: 'mirrorCostModifier must set costFactor, scalingFactor, or both',
  })

function apply(p): MirrorCostOutput {
  const { scope, id } = parseCostTarget(p.target) // the helper enemyCostModifier already uses
  return {
    kind: 'mirrorCost',
    scope,
    ...(id ? { id } : {}),
    costFactor: p.costFactor,
    scalingFactor: p.scalingFactor,
  }
}

export const mirrorCostModifier: EffectDef<MirrorCostModifierParams> = {
  schema,
  apply,
  hosts: ['passivePact', 'activePact'],
}
```

**Semantics.** For each entity `X` in scope, the factors are in force on the
owner's price of `X` while `partner.level(X) > owner.level(X)` — "they already
bought what you are about to buy". For upgrades `level` is `upgrades[id]`; for
generators it is `generators[id]`. A scope-wide target (`upgrades`) expands to
one entry per entity that satisfies the test at stamp time, so the stamped list
is always concrete `{ scope, id }` entries — `incomingCostFactors`-style
matching then needs no new branch.

**Bulk buys, accepted simplification.** The factor is per entity, not per
level: buying five sawmills while the enemy is one ahead discounts all five.
The alternative (discount only `partner.level − owner.level` levels) would push
a level bound through `getUpgradeBulkCost` and the generators' closed-form bulk
price. Not worth it for v1; noted in [Open questions](#open-questions). The
factor is `< 1` by schema — a pact is a buff by definition — and the guard is
the same shape as the `.positive()` on `durationSec`: the schema covers the
file path, a boot rule (§10) covers a programmatically built mode.

### 5. Effect `mirrorStatModifier` → output `mirrorModifier`

```ts
// shared/src/effects/seed/mirror-stat-modifier.ts
const schema = z.strictObject({
  /** Which enemy stat scales the bonus — see ENEMY_STAT_KEYS. */
  source: z.string(),
  /** The owner's pipeline target — the enemy-debuff target catalog (resource rates, `clickIncome`, `highlightFactor`). */
  field: z.string(),
  stage: z.enum(MODIFIER_STAGES),
  /** Bonus per unit of the source stat: additive → `perUnit × stat` added; multiplicative → `1 + perUnit × stat`. */
  perUnit: z.number().positive(),
  /** Upper bound on the *bonus* (additive: the added amount; multiplicative: the excess over 1). Optional = uncapped. */
  cap: z.number().positive().optional(),
})

function apply(p): MirrorModifierOutput {
  return {
    kind: 'mirrorModifier',
    source: p.source,
    field: p.field,
    stage: p.stage,
    perUnit: p.perUnit,
    cap: p.cap,
  }
}
```

`hosts: ['passivePact', 'activePact']`, `dynamic` unset (it does not read the
owner's state; the resolver reads the partner's).

**Source catalog**, `ENEMY_STAT_KEYS` in a new
`shared/src/effects/enemy-stats.ts`, one reader for every consumer:

| Key             | Reads                  | Note                                        |
| --------------- | ---------------------- | ------------------------------------------- |
| `r0` (resource) | `state.resources[r0]`  | stockpile; same spelling as the intel key   |
| `r0:rate`       | `snapshot.rates[r0]`   | **pact-free** per-second rate (§8)          |
| `peakCps`       | `meta.peakCps`         | same spelling as the intel key              |
| `score`         | `state.score`          |                                             |
| `generator:g0`  | `state.generators[g0]` | same spelling as the cost-target vocabulary |
| `generators`    | Σ `state.generators`   | total owned                                 |
| `upgrade:u3`    | `state.upgrades[u3]`   | level                                       |
| `upgrades`      | Σ `state.upgrades`     | total levels                                |

```ts
export function enemyStatKeys(mode: ModeDefinition): AddressableField[] // for validation + the editor dropdown
export function readEnemyStat(snapshot: PartnerSnapshot, key: string): number // unknown key → 0
```

**Resolution** (in the collector, §6):

```ts
const stat = readEnemyStat(partner, out.source)
const raw = out.perUnit * stat
const bonus = out.cap === undefined ? raw : Math.min(raw, out.cap)
if (bonus <= 0) continue // nothing to report or apply
modifiers.push({
  stage: out.stage,
  field: out.field,
  value: out.stage === 'additive' ? bonus : 1 + bonus,
})
```

The virtual `highlightFactor` target passes through untouched and is resolved
against the beneficiary by `resolveEnemyDebuffs`, exactly as debuffs are — the
function's name says "debuff", its arithmetic is direction-neutral. Rename to
`resolveVirtualTargets` with a `resolveEnemyDebuffs` alias if the mismatch
grates; not required.

### 6. `shared/src/pacts.ts` — the resolver module

The pact twin of `attacks.ts`. Everything that needs both players lives here,
and nothing here is called by an effect.

```ts
/** What a pact resolver may read about the partner. Assembled by the server; never sent. */
export interface PartnerSnapshot {
  readonly state: Readonly<PlayerState>
  /** The partner's per-second rates *before* their own pact bonuses (see §8). */
  readonly rates: Readonly<Record<string, number>>
}

/**
 * The passive pacts whose buffs `owner` enjoys right now, in a stable order:
 * every passive pact `owner` has unlocked, then every *mutual* passive pact
 * `partner` has unlocked. Plan 44 appends open active windows here.
 */
export function pactsInForce(owner, partner: Readonly<PlayerState>, mode): PactDefinition[]

/** One stamped discount, tagged with the pact it came from for the panel. */
export interface PactCostFactor extends EnemyCostFactor {
  readonly pact: string
}

/** The discounts in force on `owner`'s prices — concrete `{ scope, id }` entries only. */
export function collectPactCostFactors(
  owner,
  partner: Readonly<PlayerState>,
  mode,
): PactCostFactor[]

/** What one pact is worth to `owner` right now — for the pipeline and the panel. */
export interface PactBonus {
  readonly pact: string
  readonly modifiers: readonly Modifier[] // never empty
}

/**
 * What each pact in force is worth to `owner` right now. Takes *two* snapshots:
 * owner-held pacts read `partner`, partner-held mutual pacts read `owner` (the
 * roles swap, and the swapped side needs the owner's pact-free rates too).
 */
export function collectPactBonuses(
  owner: PartnerSnapshot,
  partner: PartnerSnapshot,
  mode,
): PactBonus[]

/** Flatten bonuses for the pipeline. */
export function pactModifiers(bonuses: readonly PactBonus[]): Modifier[]
```

Each collector walks `pactsInForce`, runs each ref through `applyEffect(ref,
owner.state, mode)` (the owner's state is what `apply` receives — unused by
both effects, but the signature is honored), keeps only its own output kind,
and resolves against the snapshot on the other side. The cost collector needs
no rates, so it takes bare states. The server assembles both snapshots once per
tick (§8), so the second argument is free.

### 7. The cost seam

```ts
// shared/src/types.ts — PlayerState
/**
 * Discounts the pacts in force grant on this player's prices, stamped by the
 * server on the same cadence as `incomingCostFactors` and read by every price
 * path. Absent when nothing is in force. Tagged with the granting pact for the
 * relations panel.
 */
pactCostFactors?: PactCostFactor[]
```

- `cost.ts` gains `pactCostFactors(state, scope, id): CostFactors`, the exact
  twin of `incomingCostFactors` over the other list.
- `upgradeCostFactors(state, id)` becomes
  `combineCostFactors(incomingCostFactors(…), pactCostFactors(…))`.
- `collectGeneratorCostFactors` folds the pact factors in the `'buy'` branch
  beside the incoming ones — the `for (const gen of mode.generators)` walk
  already exists; the early return on `incomingCostFactors === undefined`
  becomes "both undefined".
- The server stamps in `syncCostFactors`, so actions, bot decisions and
  broadcasts all see fresh factors — the partner's level can change on any
  message, and this is the one place that already handles that.
- The client carries the field through `clonePlayerState` like
  `incomingCostFactors`, so a replayed optimistic buy is priced as the server
  priced it.

Inflation and discount on the same item commute (both are multiplicative
factors), so an embargoed-and-mirrored sawmill costs `base × 1.25 × 0.75` on
both sides of the wire with no ordering rule.

### 8. The production seam

**Server, per tick**, before the per-player income loop:

```ts
// 1. pact-free rates for both players: own modifiers + the debuffs on them
const base = this.players.map((p, i) =>
  computePassiveRates(
    [
      ...collectModifiers(p.state, mode),
      ...resolveEnemyDebuffs(collectEnemyDebuffs(this.players[1 - i].state, mode), p.state),
    ],
    mode.resources,
  ),
)
// 2. snapshots, then bonuses, cached on MatchPlayer for the click path and the broadcast
const snaps = this.players.map((p, i) => ({ state: p.state, rates: base[i] }))
this.players[0].pactBonuses = collectPactBonuses(snaps[0], snaps[1], mode)
this.players[1].pactBonuses = collectPactBonuses(snaps[1], snaps[0], mode)
```

Then `applyPassiveIncome(player, opponent)` appends
`resolveEnemyDebuffs(pactModifiers(player.pactBonuses), player.state)` to the
modifier list it already builds, and the click path
([match.ts](../../server/src/match.ts#L680)) does the same. A click between
ticks uses the last tick's bonuses — at most one tick stale, the same
tolerance `syncCostFactors` accepted for prices before it moved to message
receipt, and a rate bonus does not need that move.

**Why pact-free rates.** If A holds "+1% wood per wood/s the enemy makes" and
so does B, reading each other's _final_ rate is a fixed-point problem. Reading
the rate before pact bonuses makes the definition explicit ("the enemy's own
production") and the computation one pass. The rule is documented on
`PartnerSnapshot.rates` and tested (§Tests).

**Wire:**

```ts
// shared/src/messages.ts — StateUpdateMessage
/**
 * What each pact in force is worth to the receiving player right now, resolved
 * server-side (the enemy stats it reads are never sent). Absent when none.
 * Merged into the client's rate and click income like `debuffs`, and listed
 * per pact by the relations panel.
 */
pactBonuses?: PactBonus[]

// OpponentView
/** The opponent's unlocked *mutual* passive pacts — the treaties the viewer also benefits from. Absent when none. */
pacts?: string[]
```

`pactBonuses` is the one deliberate leak: `value / perUnit` recovers the stat.
That is the pact's point — a trade route shows you how much timber crosses it.
`OpponentView.pacts` reveals only ids of pacts that already affect the viewer.
A partner's one-sided pacts are never sent.

**Client:**

- `GameState.pactBonuses: PactBonus[]` — replaced from `msg.pactBonuses ?? []`
  each snapshot, cleared on round start with `debuffs`.
- `GameState.opponentPacts: string[]` — same treatment from
  `msg.opponent.pacts`.
- `computePassiveRate` / `computeClickIncome` append
  `resolveEnemyDebuffs(pactModifiers(state.pactBonuses), player)` after the
  debuffs. The header rate and predicted click income then match the server's.
- `clonePlayerState` copies `pactCostFactors` (§7).

### 9. The relations panel

Replace the disabled no-op buttons with informative cards; drop the hint line.

- **Passive section** — one card per unlocked passive pact:
  - name, icon, description (flavor);
  - a "worth now" line per resolved modifier from `pactBonuses`
    (`+12% 🪵 production`, `+0.4 per click`), or `no bonus yet` when the pact
    is unlocked but resolves to nothing (the enemy has none of the source);
  - a discount line from `pactCostFactors` entries tagged with this pact
    (`−25% on 3 upgrades the enemy already owns`);
  - a `🤝 mutual` badge when `mutual`.
- **Shared treaties** — a small list of `opponentPacts` (name, icon,
  description), with their worth-now lines from `pactBonuses` entries whose
  `pact` id matches. Only rendered when non-empty.
- **Active section** — unchanged (disabled cards) until plan 44.

Rendering stays the `prevHtml` diff-and-replace the panel already does; the
worth lines change at snapshot cadence, which is fine for a panel.

The **upgrade cards** need nothing: a discounted price is just the price. A
small `pact-discount` class on the price when `pactCostFactors` hits the item
is a nicety, and one line in `upgrade-tree` rendering — optional, mind the
bundle budget.

### 10. Boot validation (`validateModeDefinition`)

In the order the attack rules run:

- **Placement:** every ref on a pact must be allowed on `passivePact` /
  `activePact` per its kind (the loop from §2).
- **`mirrorCostModifier.target`** must be in `enemyCostTargets(def)` — the
  same check `enemyCostModifier` gets, worded for pacts.
- **`mirrorStatModifier.source`** must be in `enemyStatKeys(def)`; **`field`**
  in `enemyDebuffTargets(def)`; `highlightFactor` only with
  `stage: 'multiplicative'` (copy the attack rule).
- **Passive pact with active-only fields** — schema-level today (the fields
  do not exist); becomes a boot rule in plan 44 when they do.
- **Factors `< 1`, `perUnit > 0`, `cap > 0`** for a programmatically built
  mode, mirroring the `durationSec <= 0` rule.
- A pact with `mutual: true` and no effects is legal (a placeholder that says
  what it will be).

### 11. Dev editor

- **`views/pacts.ts`**, modelled on `views/attacks.ts`: a row per pact with id,
  kind select, `mutual` checkbox, and an effects list using the existing
  schema-driven form. No cost/timing fields yet — plan 44 adds them behind the
  kind select the way attacks clear prepare data on a switch to passive.
- **Picker group** `{ label: 'Pacts', types: ['mirrorCostModifier', 'mirrorStatModifier'] }`
  in `EFFECT_GROUPS`; the grouping test enforces this.
- **Dropdowns** (`effects-editor.ts`, beside the `unlockPact` branch):
  `mirrorCostModifier.target` → `enemyCostTargets(tree)`;
  `mirrorStatModifier.source` → `enemyStatKeys(tree)`;
  `mirrorStatModifier.field` → `enemyDebuffTargets(tree)`. All three are
  `z.string()` in their schemas for exactly this reason.
- **Host filtering** in the picker follows `effectHosts` for free once the
  pact row passes its host.

### 12. Idler authoring

| Pact   | Kind    | Change                                                                                                                                                                                                                     |
| ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p2`   | passive | `effects: [{ type: 'mirrorCostModifier', target: 'upgrades', costFactor: 0.75 }]`                                                                                                                                          |
| `p3`   | passive | `mutual: true`; `effects: [{ type: 'mirrorStatModifier', source: 'generator:g0', field: 'r0', stage: 'multiplicative', perUnit: 0.02, cap: 0.5 }]`                                                                         |
| flavor |         | `p2` → "📜 Shared research" / "Upgrades the enemy already owns cost 25% less for you, while they stay ahead."; `p3` → "🪵 Trade route" / "+2% wood per enemy woodcutter, up to +50%. The enemy gains the same from yours." |

`p0` / `p1` keep their placeholder names and empty effects for plan 44. Nodes
and costs are unchanged (`cost: {}`, gated on `ir-unlock`); tuning is a later
pass, as it was for the attack nodes.

Leak decision, on record: with `p2` unlocked, a discounted price is proof the
enemy owns that upgrade — cheaper intel than `accessEnemyData: purchases`. If
that undercuts the espionage branch, gate `pact-node-3` on the purchase-feed
node with an `all` prerequisite; a data edit.

### 13. Bot

Nothing required: passive pacts resolve server-side for the bot like for any
player. One small, recommended addition — append the free `ir-unlock` and
`pact-node-3` / `pact-node-4` to `IdlerBot`'s plan (resolved through
`resolvePath` like the attack unlocks were in plan 41) so a solo player sees a
mutual treaty from the bot's side and the "Shared treaties" list has something
to show without two humans.

---

## Files touched

| File                                                                                                                       | Change                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [shared/src/types.ts](../../shared/src/types.ts)                                                                           | `PactDefinition.effects` / `.mutual`; `PactCostFactor`; `PlayerState.pactCostFactors`                                    |
| [shared/src/tree/schema.ts](../../shared/src/tree/schema.ts)                                                               | `PactSchema` fields                                                                                                      |
| [shared/src/effects/types.ts](../../shared/src/effects/types.ts)                                                           | `MirrorCostOutput`, `MirrorModifierOutput`, `EffectOutput` members, two hosts                                            |
| `shared/src/effects/seed/mirror-cost-modifier.ts` (new)                                                                    | §4                                                                                                                       |
| `shared/src/effects/seed/mirror-stat-modifier.ts` (new)                                                                    | §5                                                                                                                       |
| `shared/src/effects/enemy-stats.ts` (new)                                                                                  | `ENEMY_STAT_KEYS`, `enemyStatKeys`, `readEnemyStat`, `PartnerSnapshot`                                                   |
| [shared/src/effects/index.ts](../../shared/src/effects/index.ts)                                                           | register both; export the catalog                                                                                        |
| `shared/src/pacts.ts` (new)                                                                                                | §6 resolvers                                                                                                             |
| [shared/src/cost.ts](../../shared/src/cost.ts)                                                                             | `pactCostFactors`                                                                                                        |
| [shared/src/upgrade-costs.ts](../../shared/src/upgrade-costs.ts)                                                           | combine in `upgradeCostFactors`                                                                                          |
| [shared/src/generators.ts](../../shared/src/generators.ts)                                                                 | fold pact factors in the `'buy'` branch                                                                                  |
| [shared/src/modes/index.ts](../../shared/src/modes/index.ts)                                                               | host labels; pact placement loop; §10 rules                                                                              |
| [shared/src/messages.ts](../../shared/src/messages.ts)                                                                     | `StateUpdateMessage.pactBonuses`, `OpponentView.pacts`                                                                   |
| [server/src/match.ts](../../server/src/match.ts)                                                                           | `MatchPlayer.pactBonuses`; snapshot + collect per tick; income/click merge; stamp in `syncCostFactors`; broadcast fields |
| [server/src/bot.ts](../../server/src/bot.ts)                                                                               | plan entries (§13, optional)                                                                                             |
| [client/src/game.ts](../../client/src/game.ts)                                                                             | `pactBonuses` / `opponentPacts` state; merge into rate + click; clone field                                              |
| [client/src/ui/panels/international-relationship-panel.ts](../../client/src/ui/panels/international-relationship-panel.ts) | §9 cards                                                                                                                 |
| [client/src/style.css](../../client/src/style.css)                                                                         | `.pact-worth`, `.pact-mutual`, `.pact-shared`                                                                            |
| `client/src/dev/editor/views/pacts.ts` (new)                                                                               | §11 row                                                                                                                  |
| [client/src/dev/editor/effects-editor.ts](../../client/src/dev/editor/effects-editor.ts)                                   | picker group; three dropdown sources                                                                                     |
| [shared/trees/idler.json](../../shared/trees/idler.json)                                                                   | §12                                                                                                                      |

No new client → server message. `PlayerState` gains one optional field.

## Data / type changes

- `PactDefinition` grows two optional fields (tree version unchanged: both
  default absent, and `CURRENT_TREE_VERSION` bumps only when old files stop
  decoding).
- `EffectHost` grows two members; every exhaustive record over it is named by
  `pnpm typecheck`.
- Two new output kinds; every existing consumer ignores unknown kinds.
- `PlayerState.pactCostFactors?`, `StateUpdateMessage.pactBonuses?`,
  `OpponentView.pacts?` — all optional, absent when empty.

---

## Tests

**shared/tests/pacts.test.ts** (new)

- `pactsInForce`: owner's unlocked passives; partner's mutual passives; not the
  partner's one-sided ones; not locked ones; stable order.
- `collectPactCostFactors`: in force only while `partner.level > owner.level`;
  scope-wide target expands to concrete ids; both factors carried; tagged with
  the pact; empty when nothing is in force.
- `collectPactBonuses`: additive and multiplicative formulas; `cap` bounds the
  bonus not the value; zero stat → no entry; `highlightFactor` passes through
  unresolved; a mutual partner pact reads the _owner's_ snapshot; `:rate` reads
  `snapshot.rates`, never `state`.
- `readEnemyStat`: every key in the table; unknown → 0.

**shared/tests/effects.test.ts** (extend)

- Both schemas: required fields, `lt(1)` factors, `perUnit > 0`, the
  one-of-two refine; hosts are the two pact hosts.

**shared/tests/upgrade-costs.test.ts / generators.test.ts** (extend)

- A pact discount composes with incoming inflation on the same item (commutes).
- `getUpgradeNextCost` with a mirrored item is the discounted integer; the
  generator `'buy'` map folds it and `'sell'` ignores it.

**shared/tests/modes.test.ts / flavor.test.ts** (extend)

- Each §10 rule throws, by message. `baseModifier` on a pact is a placement
  error. Idler boots with the authored pacts (`project.test.ts`).

**server/tests/match.test.ts** (extend)

- `pactCostFactors` stamped when the bot/partner is ahead, absent otherwise,
  refreshed before an action batch is validated (buy after the partner's
  purchase pays the discounted price).
- Passive income with a `generator:g0` trade route: rate rises with the
  partner's woodcutters, capped; mutual pact credits both players.
- **No feedback:** two mirrored `:rate` pacts converge in one pass — the bonus
  equals `perUnit × partner's pact-free rate`, asserted against a hand
  computation.
- Broadcast: `pactBonuses` present with the right ids and values, absent when
  none; `opponent.pacts` lists only mutual pacts; a one-sided pact never
  appears in the partner's snapshot (assert on the serialized message, like the
  `pendingAttacks` redaction test).
- Click income between ticks uses the cached bonuses.

**client/tests** (extend / new)

- `game.test.ts`: `pactBonuses` replaced per snapshot, cleared on round start;
  predicted rate and click income include them; a replayed optimistic buy is
  priced with `pactCostFactors`.
- `relations-panel.dom.test.ts` (new): locked placeholder; a card per unlocked
  pact; worth lines from bonuses; `no bonus yet`; discount line count; mutual
  badge; shared-treaties list appears with `opponentPacts` and not without.
- Editor: grouping test passes; the three dropdowns offer the right sources;
  pact row round-trips `mutual` and effects through `io.ts`.

Full gate before push: `pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css`.
Rebuild shared (`pnpm --filter @game/shared build`) before server/client suites.

---

## Implementation stages

Each stage is one commit, reviewable alone, and leaves every suite green. A
player can reach the mechanic from stage 7.

1. **`feat(pacts): effects and mutual on PactDefinition, pact effect hosts`** —
   §1, §2, placement validation, schema, tests. Nothing emits or reads a pact
   output yet.
2. **`feat(effects): enemy stat catalog and reader`** — `enemy-stats.ts`,
   `PartnerSnapshot`, tests. Consumed by nothing.
3. **`feat(pacts): mirrorCostModifier and the pact cost seam`** — §4, §7,
   `collectPactCostFactors`, `pactCostFactors` in `cost.ts`, the two price
   seams, server stamp, client clone, tests. The first visible behavior, if a
   pact were authored.
4. **`feat(pacts): mirrorStatModifier and resolved pact bonuses`** — §5, §6
   bonuses, server snapshot + tick merge + click merge, tests. Income moves;
   the client's header does not yet.
5. **`feat(net): pactBonuses and opponent pacts on STATE_UPDATE`** — §8 wire,
   broadcast assembly, redaction tests, client state + merge. Header and
   predicted clicks now agree with the server.
6. **`feat(client): relations panel shows what each pact is worth`** — §9, CSS,
   DOM tests.
7. **`feat(idler): author Shared research and Trade route`** — §12. First
   reachable commit. The leak decision goes in the commit body.
8. **`feat(editor): pact row, picker group, catalog dropdowns`** — §11. Could
   precede stage 7 if hand-editing the JSON is unwanted.
9. **`feat(bot): unlock the free pact nodes`** — §13. Optional and last.

---

## Open questions

1. **Bulk-buy over-discount** (§4). Ship the per-entity factor, or bound the
   discount to `partner.level − owner.level` levels? The bound needs a
   level-aware `getUpgradeBulkCost` and a split generator bulk price.
   _Proposed: ship per-entity; revisit if buy-max abuses it in play._
2. **Should `:rate` sources be in v1 at all?** They are the one source needing
   the snapshot rule. Kept because "boost by their production per second" was
   an explicit ask; drop from `ENEMY_STAT_KEYS` if the rule feels like a trap.
3. **Cap semantics for additive `highlightFactor`.** The virtual target is
   multiplicative-only (inherited rule), so no additive cap question arises
   there; for real additive fields `cap` bounds the added amount. Confirm this
   reads right on the card.
4. **Does a mutual pact deserve its own toast** ("🤝 Trade route signed by the
   enemy")? Plan 31 reserved the copy; a first-appearance-in-`opponentPacts`
   trigger is ~10 lines. _Proposed: yes, in stage 5._

---

## Deferred

- **Active pacts** — [plan 44](44-active-pacts.md): activation, windows,
  `activationCost`, the `activePact` host reader, `activate_pact`, bot firing.
- **Cooldowns** — [plan 43](43-activation-cooldowns.md): meaningless for a
  passive pact, designed for active pacts and active attacks together.
- **A flat shared buff** (`pactProductionModifier`: "+10% wood for both") —
  trivially resolved by the same module; left to plan 44 where a timed
  ceasefire is its natural home.
- **A `pactsSigned` meta prerequisite** — one whitelist entry once active pacts
  exist (plan 41's mechanism).
- **Simulator** modelling of pacts — single-player, blind, as every attack
  plan since 29.
- **Level-bounded discounts** (open question 1).
