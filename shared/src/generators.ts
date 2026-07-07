import type { CostEntry, GeneratorDefinition, PlayerState } from './types.js'
import type { ModeDefinition } from './modes/types.js'
import type { EffectOutput, GeneratorCostOutput } from './effects/index.js'
// Importing from the effects barrel ensures seed effects (incl. `generatorCost`)
// are registered whenever cost factors are collected.
import { applyEffect, normalizeEffectOutputs } from './effects/index.js'
import { isFlatCost, scaledCost } from './cost.js'
import { anyOwned, generatorGateUpgrades } from './unlock-gates.js'

/** The single currency a generator is paid in (generators are single-currency). */
export function generatorCostCurrency(def: GeneratorDefinition): string {
  return Object.keys(def.cost)[0] ?? ''
}

/** The generator's single {@link CostEntry} (its cost curve). */
function generatorCostEntry(def: GeneratorDefinition): CostEntry {
  return Object.values(def.cost)[0] ?? { base: 0 }
}

/** Aggregated cost reductions for a single generator (1 = no reduction). */
export interface GeneratorCostFactors {
  /** Multiplier on the generator's base cost. */
  readonly costFactor: number
  /** Multiplier on the growth portion (`costScaling - 1`) of the cost curve. */
  readonly scalingFactor: number
}

const NEUTRAL_COST_FACTORS: GeneratorCostFactors = { costFactor: 1, scalingFactor: 1 }

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
 * cost factors. Factors stack multiplicatively and compound with the owning
 * upgrade's owned count (`factor ** owned`). Generators with no reductions are
 * absent from the map (callers fall back to {@link NEUTRAL_COST_FACTORS}).
 */
export function collectGeneratorCostFactors(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): Map<string, GeneratorCostFactors> {
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
  factors: GeneratorCostFactors = NEUTRAL_COST_FACTORS,
): GeneratorDefinition {
  if (factors.costFactor === 1 && factors.scalingFactor === 1) return def
  const currency = generatorCostCurrency(def)
  const entry = generatorCostEntry(def)
  const scaledBase = entry.base * factors.costFactor
  const scaled: CostEntry =
    entry.scaleType !== undefined && entry.scaleFactor !== undefined
      ? {
          ...entry,
          base: scaledBase,
          scaleFactor:
            entry.scaleType === 'exponential'
              ? 1 + (entry.scaleFactor - 1) * factors.scalingFactor
              : entry.scaleFactor * factors.scalingFactor,
        }
      : { ...entry, base: scaledBase }
  return { ...def, cost: { [currency]: scaled } }
}

/**
 * Resolve a generator's cost-adjusted definition for a given player + mode.
 * Convenience over `collectGeneratorCostFactors` + `applyGeneratorCostFactors`
 * for single-generator call sites.
 */
export function resolveGeneratorDef(
  def: GeneratorDefinition,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): GeneratorDefinition {
  const factors = collectGeneratorCostFactors(state, mode).get(def.id)
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
 * upgrade carrying a `generatorUnlock` effect naming it: locked until one such
 * upgrade is owned. A generator that no upgrade unlocks is always available.
 */
export function isGeneratorUnlocked(
  state: Readonly<PlayerState>,
  gen: GeneratorDefinition,
  mode: ModeDefinition,
): boolean {
  const gates = generatorGateUpgrades(mode, gen.id)
  if (!gates) return true // no upgrade gates this generator → always available
  return anyOwned(state, gates)
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
