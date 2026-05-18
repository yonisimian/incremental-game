import type { GeneratorDefinition, PlayerState } from './types.js'
import type { ModeDefinition } from './modes/types.js'

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
    return Math.floor(budget / def.baseCost)
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
