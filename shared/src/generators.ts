import type { GeneratorDefinition, PlayerState } from './types.js'
import type { ModeDefinition } from './modes/types.js'

/** Compute the cost of the next copy of a generator. */
export function getGeneratorCost(def: GeneratorDefinition, owned: number): number {
  return Math.floor(def.baseCost * def.costScaling ** owned)
}

/** Can the player afford the next copy of this generator? */
export function canAffordGenerator(
  state: Readonly<PlayerState>,
  def: GeneratorDefinition,
): boolean {
  const cost = getGeneratorCost(def, state.generators[def.id] ?? 0)
  return (state.resources[def.costCurrency] ?? 0) >= cost
}

/** Deduct cost and increment owned count for a generator. */
export function applyGeneratorPurchase(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): void {
  const def = mode.generators.find((g) => g.id === generatorId)
  if (!def) return
  const owned = state.generators[def.id] ?? 0
  const cost = getGeneratorCost(def, owned)
  state.resources[def.costCurrency] -= cost
  state.generators[def.id] = owned + 1
}
