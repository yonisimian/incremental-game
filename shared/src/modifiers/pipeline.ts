import type { LayerAccumulator, Modifier, ModifierContext, ResourceLayers } from './types.js'
import { INCOMING_CLICK_INCOME_FIELD } from './types.js'
import type { PlayerState } from '../types.js'
import { advanceGameSec } from '../game-clock.js'
import { MAX_RESOURCE } from '../game-config.js'

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
    clickIncome: { own: { add: 0, mult: 1 }, incoming: { add: 0, mult: 1 } },
    resources: {},
  }
  // Seed every declared resource so each key is always present downstream.
  for (const key of resources) ctx.resources[key] = freshLayers()

  for (const m of modifiers) {
    // The click track: own and incoming modifiers land in separate accumulators,
    // composed once by `computeClickIncome`, so array order never matters.
    const clickLayer =
      m.field === 'clickIncome'
        ? ctx.clickIncome.own
        : m.field === INCOMING_CLICK_INCOME_FIELD
          ? ctx.clickIncome.incoming
          : null
    if (clickLayer) {
      if (m.stage === 'additive') clickLayer.add += m.value
      else clickLayer.mult *= m.value
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
function saturateRate(value: number): number {
  if (value === Infinity) return MAX_RESOURCE
  if (value === -Infinity) return -MAX_RESOURCE
  if (Number.isNaN(value)) return 0
  return Math.min(MAX_RESOURCE, value)
}

function finalizeRate(layers: ResourceLayers | undefined): number {
  if (!layers) return 0
  const base = layers.base.add * layers.base.mult
  return saturateRate((base + layers.global.add) * layers.global.mult)
}

/**
 * Credit `amount` of `resource` to `state`, saturating at {@link MAX_RESOURCE},
 * and mirror it into `score` when it's the score resource. A non-finite amount
 * credits nothing except `Infinity`, which saturates to the cap.
 */
export function creditResource(
  state: PlayerState,
  resource: string,
  amount: number,
  scoreResource: string,
): void {
  if (Number.isNaN(amount) || amount <= 0) return
  const gain = amount === Infinity ? MAX_RESOURCE : amount
  state.resources[resource] = Math.min(MAX_RESOURCE, (state.resources[resource] ?? 0) + gain)
  if (resource === scoreResource) {
    state.score = Math.min(MAX_RESOURCE, state.score + gain)
  }
}

// ─── Convenience Functions ───────────────────────────────────────────

/**
 * Compute the income from a single click:
 * `own.add · own.mult · incoming.mult + incoming.add` (see `ClickLayers`).
 *
 * The player's own click power is built first; an incoming multiplier scales it
 * and an incoming flat drain comes off last, unscaled — so a `−2` debuff always
 * costs exactly 2, and the result doesn't depend on modifier order.
 *
 * Floored at `0`: an additive drain can overshoot the click's worth.
 * `creditResource` already ignores a non-positive amount, so nothing is ever
 * *drained* by a click — the floor keeps the figure the UI and the sim read equal
 * to the credit actually applied.
 */
export function computeClickIncome(modifiers: readonly Modifier[]): number {
  const { own, incoming } = computeIncome(modifiers).clickIncome
  return Math.max(0, saturateRate(own.add * own.mult * incoming.mult + incoming.add))
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
  advanceGameSec(state, tickSec)

  const rates = computePassiveRates(modifiers, resources)

  for (const resource of resources) {
    const gain = rates[resource] * tickSec
    creditResource(state, resource, gain, scoreResource)
  }
}
