import type { Modifier } from '../modifiers/types.js'
import type { EffectRef, PlayerState } from '../types.js'
import type { EffectDef } from './types.js'

const registry = new Map<string, EffectDef<unknown>>()

/** A resolved effect plus its parsed params, cached per ref identity. */
interface PreparedEffect {
  readonly def: EffectDef<unknown>
  readonly params: unknown
}
const prepared = new WeakMap<EffectRef, PreparedEffect>()

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
 * Resolve and validate a ref once, caching the result by ref identity.
 *
 * Effect refs are immutable, code-authored data, so each distinct ref is parsed
 * exactly once; every later call (e.g. per tick) reuses the cached params. Call
 * this at startup (see `validateModeDefinition`) to fail fast on malformed data.
 *
 * Throws on an unknown effect type: an unknown type is a bug that should surface
 * immediately rather than be silently dropped. (The Phase 4 JSON boundary will
 * validate refs before they ever reach the runtime.)
 */
export function prepareEffect(ref: EffectRef): PreparedEffect {
  const cached = prepared.get(ref)
  if (cached) return cached
  const def = registry.get(ref.type)
  if (!def) {
    throw new Error(`Unknown effect type: ${ref.type}`)
  }
  const entry: PreparedEffect = { def, params: def.parse(ref) }
  prepared.set(ref, entry)
  return entry
}

/**
 * Run an effect for the given state, returning a modifier or `null`.
 * Params are resolved + parsed once per ref (see `prepareEffect`).
 */
export function applyEffect(ref: EffectRef, state: Readonly<PlayerState>): Modifier | null {
  const { def, params } = prepareEffect(ref)
  return def.apply(params, state)
}
