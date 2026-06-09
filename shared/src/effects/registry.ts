import type { Modifier } from '../modifiers/types.js'
import type { EffectRef, PlayerState } from '../types.js'
import type { EffectDef } from './types.js'

const registry = new Map<string, EffectDef<unknown>>()

/** Register an effect implementation under a unique `type` name. */
export function registerEffect<P>(type: string, def: EffectDef<P>): void {
  if (registry.has(type)) {
    throw new Error(`Effect type already registered: ${type}`)
  }
  registry.set(type, def as EffectDef<unknown>)
}

/** Look up a registered effect, or `undefined` if the type is unknown. */
export function resolveEffect(type: string): EffectDef<unknown> | undefined {
  return registry.get(type)
}

/**
 * Validate `ref`'s params and run its effect, returning a modifier or `null`.
 *
 * Throws on an unknown effect type: effect refs are trusted, code-authored data,
 * so an unknown type is a bug that should surface immediately rather than be
 * silently dropped. (The Phase 4 JSON boundary will validate refs before they
 * ever reach the runtime.)
 */
export function applyEffect(ref: EffectRef, state: Readonly<PlayerState>): Modifier | null {
  const def = registry.get(ref.type)
  if (!def) {
    throw new Error(`Unknown effect type: ${ref.type}`)
  }
  const params = def.parse(ref)
  return def.apply(params, state)
}
