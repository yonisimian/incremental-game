import type { GeneratorDefinition, PlayerState } from './types.js'
import type { ModeDefinition } from './modes/types.js'
import type { EffectOutput, GeneratorCostOutput } from './effects/index.js'
// Importing from the effects barrel ensures seed effects (incl. `generatorCost`)
// are registered whenever cost factors are collected.
import { applyEffect, normalizeEffectOutputs } from './effects/index.js'
import { anyOwned, generatorGateUpgrades } from './unlock-gates.js'

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
 * `baseCost` is scaled by `costFactor`; the growth portion of `costScaling` is
 * scaled by `scalingFactor` (`1 + (costScaling - 1) * scalingFactor`). With
 * neutral factors the definition is returned unchanged.
 */
export function applyGeneratorCostFactors(
  def: GeneratorDefinition,
  factors: GeneratorCostFactors = NEUTRAL_COST_FACTORS,
): GeneratorDefinition {
  if (factors.costFactor === 1 && factors.scalingFactor === 1) return def
  return {
    ...def,
    baseCost: def.baseCost * factors.costFactor,
    costScaling: 1 + (def.costScaling - 1) * factors.scalingFactor,
  }
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
  return Math.floor(def.baseCost * def.costScaling ** owned)
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
  const budget = state.resources[def.costCurrency] ?? 0
  if (budget <= 0) return 0

  const owned = state.generators[def.id] ?? 0
  if (def.costScaling === 1) {
    // Divide by the floored per-unit cost so the fast path matches
    // `getGeneratorCost` (cost reductions can make `baseCost` fractional).
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
  return (state.resources[def.costCurrency] ?? 0) >= cost
}

/**
 * Is this generator available to the player yet? Combines the legacy
 * `unlockUpgrade` field with any `generatorUnlock` effect naming this generator
 * (OR semantics, mirroring the highlight/click gates): a generator with neither
 * gate is always unlocked; otherwise owning the named upgrade or any gating
 * upgrade reveals it.
 */
export function isGeneratorUnlocked(
  state: Readonly<PlayerState>,
  gen: GeneratorDefinition,
  mode: ModeDefinition,
): boolean {
  const effectGates = generatorGateUpgrades(mode, gen.id)
  if (!gen.unlockUpgrade && !effectGates) return true
  if (gen.unlockUpgrade && (state.upgrades[gen.unlockUpgrade] ?? 0) > 0) return true
  return anyOwned(state, effectGates)
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
  state.resources[def.costCurrency] -= cost
  state.generators[def.id] = owned + 1
}
