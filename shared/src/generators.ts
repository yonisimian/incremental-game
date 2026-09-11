import type { CostEntry, GeneratorDefinition, PlayerState } from './types.js'
import type { ModeDefinition } from './modes/types.js'
import type { EffectOutput, GeneratorCostOutput } from './effects/index.js'
// Importing from the effects barrel ensures seed effects (incl. `generatorCost`)
// are registered whenever cost factors are collected.
import { applyEffect, normalizeEffectOutputs } from './effects/index.js'
import type { CostFactors } from './cost.js'
import {
  applyCostFactors,
  combineCostFactors,
  incomingCostFactors,
  isFlatCost,
  isNeutralCostFactors,
  NEUTRAL_COST_FACTORS,
  scaledCost,
} from './cost.js'
import { generatorGate, isGranted } from './unlock-gates.js'
import { GENERATOR_SELL_REFUND_RATE } from './game-config.js'

/** The single currency a generator is paid in (generators are single-currency). */
export function generatorCostCurrency(def: GeneratorDefinition): string {
  return Object.keys(def.cost)[0] ?? ''
}

/** The generator's single {@link CostEntry} (its cost curve). */
function generatorCostEntry(def: GeneratorDefinition): CostEntry {
  return Object.values(def.cost)[0] ?? { baseCost: 0 }
}

/**
 * Whether a generator price is being *paid* or *refunded*. The two resolve
 * different factor sets: buying pays the player's own reductions **and** any
 * inflation the opponent inflicts, while a refund is priced off the player's own
 * economy alone (see {@link getGeneratorSellRefund}).
 */
export type CostPurpose = 'buy' | 'sell'

/**
 * Whether an effect output is a generator cost reduction. Other outputs carry a
 * different `kind` (e.g. `panelUnlock`) or none at all (a production `Modifier`),
 * so match the tag explicitly.
 */
function isCostOutput(out: EffectOutput): out is GeneratorCostOutput {
  return 'kind' in out && out.kind === 'generatorCost'
}

/**
 * Aggregate every owned upgrade's `generatorCost` effects into per-generator
 * cost factors, then — when a price is being *paid* (`purpose: 'buy'`) — fold in
 * the inflation the opponent's passive attacks inflict on this player.
 *
 * Own factors stack multiplicatively and compound with the owning upgrade's
 * owned count (`factor ** owned`); incoming inflation carries no owned count (an
 * attack is unlocked or it isn't) and multiplies in afterwards, so a reduction
 * and an inflation on the same generator commute. Generators with neither are
 * absent from the map (callers fall back to `NEUTRAL_COST_FACTORS`).
 */
export function collectGeneratorCostFactors(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  purpose: CostPurpose = 'buy',
): Map<string, CostFactors> {
  const factors = new Map<string, { costFactor: number; scalingFactor: number }>()
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned <= 0) continue
    for (const ref of upgrade.effects ?? []) {
      // Skip non-cost effects without running them: only `generatorCost` yields
      // a cost output, so there's no need to evaluate production effects here.
      if (ref.type !== 'generatorCost') continue
      for (const o of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        if (!isCostOutput(o)) continue
        const entry = factors.get(o.generator) ?? { costFactor: 1, scalingFactor: 1 }
        if (o.costFactor !== undefined) entry.costFactor *= o.costFactor ** owned
        if (o.scalingFactor !== undefined) entry.scalingFactor *= o.scalingFactor ** owned
        factors.set(o.generator, entry)
      }
    }
  }
  if (purpose === 'sell' || state.incomingCostFactors === undefined) return factors
  // A whole-scope inflation hits generators the player has no reduction for, so
  // walk the mode's list rather than only the entries collected above.
  for (const gen of mode.generators) {
    const incoming = incomingCostFactors(state, 'generator', gen.id)
    if (isNeutralCostFactors(incoming)) continue
    const own = factors.get(gen.id) ?? NEUTRAL_COST_FACTORS
    factors.set(gen.id, { ...combineCostFactors(own, incoming) })
  }
  return factors
}

/**
 * Apply cost factors to a generator definition, returning a cost-adjusted copy.
 * The cost entry's `base` is scaled by `costFactor`; the growth portion of its
 * scaling is scaled by `scalingFactor` (exponential: `1 + (scaleFactor-1)*sf`;
 * linear: `scaleFactor*sf`). With neutral factors the definition is unchanged.
 */
export function applyGeneratorCostFactors(
  def: GeneratorDefinition,
  factors: CostFactors = NEUTRAL_COST_FACTORS,
): GeneratorDefinition {
  if (isNeutralCostFactors(factors)) return def
  const currency = generatorCostCurrency(def)
  const scaled: CostEntry = applyCostFactors(generatorCostEntry(def), factors)
  return { ...def, cost: { [currency]: scaled } }
}

/**
 * Resolve a generator's cost-adjusted definition for a given player + mode.
 * Convenience over `collectGeneratorCostFactors` + `applyGeneratorCostFactors`
 * for single-generator call sites.
 *
 * `purpose` decides whether the opponent's cost inflation is folded in: a price
 * being paid (the default) carries it, a refund does not.
 */
export function resolveGeneratorDef(
  def: GeneratorDefinition,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  purpose: CostPurpose = 'buy',
): GeneratorDefinition {
  const factors = collectGeneratorCostFactors(state, mode, purpose).get(def.id)
  return applyGeneratorCostFactors(def, factors)
}

/** Compute the cost of the next copy of a generator. */
export function getGeneratorCost(def: GeneratorDefinition, owned: number): number {
  return Math.floor(scaledCost(generatorCostEntry(def), owned))
}

/** Compute the total cost to buy `quantity` additional copies. */
export function getGeneratorBulkCost(
  def: GeneratorDefinition,
  owned: number,
  quantity: number,
): number {
  if (quantity <= 0) return 0
  let total = 0
  for (let i = 0; i < quantity; i += 1) {
    total += getGeneratorCost(def, owned + i)
  }
  return total
}

/**
 * Refund for selling one copy, given the *cost-adjusted* definition. Prices the
 * copy being removed (index `owned - 1`) — the same price a re-buy will charge
 * from the player's *own* economy.
 *
 * Callers must resolve the definition with `purpose: 'sell'`, i.e. **without**
 * the opponent's cost inflation. Including it would make the refund track the
 * attack: at an inflation of ×2 or more a copy would refund more than it cost to
 * buy, turning the attack into a gift and opening a sell/re-buy money pump. The
 * enemy inflates what you *pay*, not what your assets are worth.
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
 * `state.resources` only — never `state.score`. Resolves at `'sell'` so the
 * refund ignores enemy inflation (see {@link getGeneratorSellRefund}).
 */
export function applyGeneratorSell(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): void {
  const def = mode.generators.find((g) => g.id === generatorId)
  if (!def) return
  const effectiveDef = resolveGeneratorDef(def, state, mode, 'sell')
  const owned = state.generators[def.id] ?? 0
  if (owned <= 0) return
  const refund = getGeneratorSellRefund(effectiveDef, owned)
  const currency = generatorCostCurrency(def)
  state.resources[currency] = (state.resources[currency] ?? 0) + refund
  state.generators[def.id] = owned - 1
}

/** How many copies can the player afford right now? */
export function getMaxAffordableGeneratorCount(
  state: Readonly<PlayerState>,
  def: GeneratorDefinition,
): number {
  const budget = state.resources[generatorCostCurrency(def)] ?? 0
  if (budget <= 0) return 0

  const owned = state.generators[def.id] ?? 0
  if (isFlatCost(generatorCostEntry(def))) {
    // Divide by the floored per-unit cost so the fast path matches
    // `getGeneratorCost` (cost reductions can make `base` fractional).
    const unitCost = getGeneratorCost(def, owned)
    return unitCost <= 0 ? 0 : Math.floor(budget / unitCost)
  }

  let affordable = 0
  let remaining = budget
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const cost = getGeneratorCost(def, owned + affordable)
    // Guard against a non-increasing curve (e.g. a degenerate `scaleFactor < 1`)
    // whose floored cost hits 0: a free copy would loop forever. Stop counting,
    // mirroring the flat fast-path's zero-cost bail-out.
    if (cost <= 0) break
    if (cost > remaining) break
    remaining -= cost
    affordable += 1
  }

  return affordable
}

/** Can the player afford the next copy of this generator? */
export function canAffordGenerator(
  state: Readonly<PlayerState>,
  def: GeneratorDefinition,
): boolean {
  const cost = getGeneratorCost(def, state.generators[def.id] ?? 0)
  return (state.resources[generatorCostCurrency(def)] ?? 0) >= cost
}

/**
 * Is this generator available to the player yet? A generator is gated by any
 * `generatorUnlock` effect naming it: locked until that grant is in force (an
 * owned upgrade, or the mode's starting effects, which grant for the whole round).
 * A generator nothing unlocks is always available.
 */
export function isGeneratorUnlocked(
  state: Readonly<PlayerState>,
  gen: GeneratorDefinition,
  mode: ModeDefinition,
): boolean {
  const gate = generatorGate(mode, gen.id)
  if (!gate) return true // nothing gates this generator → always available
  return isGranted(state, gate)
}

/** Deduct cost and increment owned count for a generator. */
export function applyGeneratorPurchase(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): void {
  const def = mode.generators.find((g) => g.id === generatorId)
  if (!def) return
  const effectiveDef = resolveGeneratorDef(def, state, mode)
  const owned = state.generators[def.id] ?? 0
  const cost = getGeneratorCost(effectiveDef, owned)
  state.resources[generatorCostCurrency(def)] -= cost
  state.generators[def.id] = owned + 1
}
