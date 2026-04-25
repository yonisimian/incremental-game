import type { Modifier, ModifierContext } from './types.js'
import type { PlayerState } from '../types.js'

// ─── Pipeline Core ───────────────────────────────────────────────────

/**
 * Run the modifier pipeline: seed → additive → multiplicative → global.
 * Returns the raw ModifierContext (globalMultiplier NOT yet applied to fields).
 */
export function computeIncome(modifiers: readonly Modifier[]): ModifierContext {
  // 1. SEED
  const ctx: ModifierContext = {
    clickIncome: 0,
    rates: {},
    globalMultiplier: 1.0,
  }

  // 2. ADDITIVE
  for (const m of modifiers) {
    if (m.stage !== 'additive') continue
    if (m.field === 'clickIncome') {
      ctx.clickIncome += m.value
    } else if (m.field === 'globalMultiplier') {
      ctx.globalMultiplier += m.value
    } else {
      ctx.rates[m.field] = (ctx.rates[m.field] ?? 0) + m.value
    }
  }

  // 3. MULTIPLICATIVE
  for (const m of modifiers) {
    if (m.stage !== 'multiplicative') continue
    if (m.field === 'clickIncome') {
      ctx.clickIncome *= m.value
    } else if (m.field === 'globalMultiplier') {
      ctx.globalMultiplier *= m.value
    } else {
      ctx.rates[m.field] = (ctx.rates[m.field] ?? 0) * m.value
    }
  }

  // 4. GLOBAL
  for (const m of modifiers) {
    if (m.stage !== 'global') continue
    ctx.globalMultiplier *= m.value
  }

  return ctx
}

// ─── Convenience Functions ───────────────────────────────────────────

/** Compute the income from a single click (globalMultiplier applied). */
export function computeClickIncome(modifiers: readonly Modifier[]): number {
  const ctx = computeIncome(modifiers)
  return ctx.clickIncome * ctx.globalMultiplier
}

/**
 * Compute passive income rates per second as a resource map.
 * Keys are seeded from `resources` so every declared key is always present.
 * globalMultiplier is applied to each rate.
 */
export function computePassiveRates(
  modifiers: readonly Modifier[],
  resources: readonly string[],
): Record<string, number> {
  const ctx = computeIncome(modifiers)
  const result: Record<string, number> = {}
  for (const key of resources) {
    result[key] = (ctx.rates[key] ?? 0) * ctx.globalMultiplier
  }
  return result
}

// ─── State Mutation ──────────────────────────────────────────────────

/**
 * Apply one tick of passive income to a player state.
 * Mutates `state` in place.
 *
 * @param state - The player state to mutate.
 * @param resources - Mode-declared resource keys (e.g., ['currency'] or ['wood', 'ale']).
 * @param scoreResource - Which resource contributes to score.
 * @param modifiers - Collected modifiers for this player.
 * @param tickSec - Tick duration in seconds.
 */
export function applyPassiveTick(
  state: PlayerState,
  resources: readonly string[],
  scoreResource: string,
  modifiers: readonly Modifier[],
  tickSec: number,
): void {
  const rates = computePassiveRates(modifiers, resources)

  for (const resource of resources) {
    const gain = rates[resource] * tickSec
    state.resources[resource] = (state.resources[resource] ?? 0) + gain
    if (resource === scoreResource) state.score += gain
  }
}
