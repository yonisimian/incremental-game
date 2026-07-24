import type { LayerAccumulator, Modifier, ModifierContext, ResourceLayers } from './types.js'
import type { PlayerState } from '../types.js'

// ─── Pipeline Core ───────────────────────────────────────────────────

/** A fresh set of scoped layers for one resource (neutral: add 0, mult 1). */
function freshLayers(): ResourceLayers {
  return {
    base: { add: 0, mult: 1 },
    generator: { add: 0, mult: 1 },
    global: { add: 0, mult: 1 },
  }
}

/**
 * Run the modifier pipeline, accumulating each resource's `base` / `generator` /
 * `global` layers plus the standalone `globalMultiplier` track. Returns the raw
 * {@link ModifierContext} — the layers are NOT yet combined into a rate (see
 * {@link finalizeRate}). Per-generator output is assumed already folded into
 * `generator`-scope resource modifiers by `collectModifiers`, so this never sees
 * a generator-id `field`. (Click income is its own axis — see `clickPower` /
 * `computeClickIncome` — and does not flow through here.)
 */
export function computeIncome(modifiers: readonly Modifier[]): ModifierContext {
  const ctx: ModifierContext = {
    resources: {},
    globalMultiplier: 1.0,
  }

  const layersFor = (field: string): ResourceLayers => (ctx.resources[field] ??= freshLayers())

  for (const m of modifiers) {
    // The `globalMultiplier` field has its own track; `scope` does not apply.
    if (m.field === 'globalMultiplier') {
      if (m.stage === 'additive') ctx.globalMultiplier += m.value
      else ctx.globalMultiplier *= m.value
      continue
    }
    // Resource field: route into the layer named by `scope`.
    const layer: LayerAccumulator = layersFor(m.field)[m.scope]
    if (m.stage === 'additive') layer.add += m.value
    else layer.mult *= m.value
  }

  return ctx
}

/**
 * Combine one resource's scoped layers into its per-second rate:
 * `((base.add·base.mult) + (generator.add·generator.mult) + global.add) ·
 * global.mult · globalMultiplier`. `global` (per-resource) wraps the base +
 * generator subtotal; `globalMultiplier` scales everything on top.
 */
function finalizeRate(layers: ResourceLayers | undefined, globalMultiplier: number): number {
  if (!layers) return 0
  const base = layers.base.add * layers.base.mult
  const generator = layers.generator.add * layers.generator.mult
  const combined = (base + generator + layers.global.add) * layers.global.mult
  return combined * globalMultiplier
}

// ─── Convenience Functions ───────────────────────────────────────────

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
    result[key] = finalizeRate(ctx.resources[key], ctx.globalMultiplier)
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
  // Track cumulative game time for time-based upgrades
  const prevSec = (state.meta.gameSec as number | undefined) ?? 0
  state.meta.gameSec = prevSec + tickSec

  const rates = computePassiveRates(modifiers, resources)

  for (const resource of resources) {
    const gain = rates[resource] * tickSec
    state.resources[resource] = (state.resources[resource] ?? 0) + gain
    if (resource === scoreResource) state.score += gain
  }
}
