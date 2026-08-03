import type { LayerAccumulator, Modifier, ModifierContext, ResourceLayers } from './types.js'
import type { PlayerState } from '../types.js'

// ─── Pipeline Core ───────────────────────────────────────────────────

/** A fresh set of production layers for one resource (neutral: add 0, mult 1). */
function freshLayers(): ResourceLayers {
  return {
    base: { add: 0, mult: 1 },
    global: { add: 0, mult: 1 },
  }
}

/** Matches a base-producer field `bK` (K = resource index), capturing K. */
const BASE_FIELD_RE = /^b(\d+)$/

/**
 * Resolve a modifier `field` to the resource layer it targets, or `null` if it
 * isn't a resource field the pipeline owns (`clickIncome` is handled
 * separately; generator ids are folded away before this runs). A `bK` field maps
 * to the base layer of the K-th declared resource; a raw resource id maps to
 * its global layer. An out-of-range `bK` or unknown id is inert here —
 * `validateModeDefinition` already rejects those at boot.
 */
function resolveField(
  field: string,
  resources: readonly string[],
): { key: string; layer: keyof ResourceLayers } | null {
  const baseMatch = BASE_FIELD_RE.exec(field)
  if (baseMatch) {
    const index = Number(baseMatch[1])
    return index < resources.length ? { key: resources[index], layer: 'base' } : null
  }
  return resources.includes(field) ? { key: field, layer: 'global' } : null
}

/**
 * Run the modifier pipeline: accumulate each resource's `base` / `global` layers
 * plus the standalone `clickIncome` track. Returns the raw {@link ModifierContext}
 * — layers are NOT yet combined into a rate (see {@link finalizeRate}).
 * Per-generator output is assumed already folded into resource-id (`global`-layer)
 * modifiers by `collectModifiers`, so this never sees a generator-id `field`.
 */
export function computeIncome(
  modifiers: readonly Modifier[],
  resources: readonly string[] = [],
): ModifierContext {
  const ctx: ModifierContext = {
    clickIncome: 0,
    resources: {},
  }
  // Seed every declared resource so each key is always present downstream.
  for (const key of resources) ctx.resources[key] = freshLayers()

  for (const m of modifiers) {
    // Standalone tracks: not per-resource, not layered.
    if (m.field === 'clickIncome') {
      if (m.stage === 'additive') ctx.clickIncome += m.value
      else ctx.clickIncome *= m.value
      continue
    }
    // Resource field: route into the base or global layer.
    const target = resolveField(m.field, resources)
    if (!target) continue
    const layer: LayerAccumulator = (ctx.resources[target.key] ??= freshLayers())[target.layer]
    if (m.stage === 'additive') layer.add += m.value
    else layer.mult *= m.value
  }

  return ctx
}

/**
 * Combine one resource's layers into its per-second rate:
 * `(base.add·base.mult + global.add) · global.mult`.
 * The `global` layer (per-resource multiplier + folded generator output) wraps
 * the base subtotal.
 */
function finalizeRate(layers: ResourceLayers | undefined): number {
  if (!layers) return 0
  const base = layers.base.add * layers.base.mult
  return (base + layers.global.add) * layers.global.mult
}

// ─── Convenience Functions ───────────────────────────────────────────

/** Compute the income from a single click. */
export function computeClickIncome(modifiers: readonly Modifier[]): number {
  return computeIncome(modifiers).clickIncome
}

/**
 * Compute passive income rates per second as a resource map.
 * Keys are seeded from `resources` so every declared key is always present.
 */
export function computePassiveRates(
  modifiers: readonly Modifier[],
  resources: readonly string[],
): Record<string, number> {
  const ctx = computeIncome(modifiers, resources)
  const result: Record<string, number> = {}
  for (const key of resources) {
    result[key] = finalizeRate(ctx.resources[key])
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
