import type { ModeDefinition } from '../modes/types.js'
import type { EffectRef, PlayerState } from '../types.js'
import type { EffectDef, EffectOutput } from './types.js'

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

/** Every registered effect type name, sorted — the source list for the editor's picker. */
export function listEffectTypes(): string[] {
  return [...registry.keys()].sort()
}

/**
 * Resolve and validate a ref once, caching the result by ref identity.
 *
 * Effect refs are immutable data, so each distinct ref is validated exactly once;
 * every later call (e.g. per tick) reuses the cached params. Call this at startup
 * (see `validateModeDefinition`) to fail fast on malformed data.
 *
 * The ref's `type` discriminant is stripped before validation: the effect's
 * schema describes its params only. A strict schema would otherwise reject the
 * leftover `type` key.
 *
 * Throws on an unknown effect type: an unknown type is a bug that should surface
 * immediately rather than be silently dropped.
 */
export function prepareEffect(ref: EffectRef): PreparedEffect {
  const cached = prepared.get(ref)
  if (cached) return cached
  const def = registry.get(ref.type)
  if (!def) {
    throw new Error(`Unknown effect type: ${ref.type}`)
  }
  const { type: _type, ...rawParams } = ref
  const entry: PreparedEffect = { def, params: def.schema.parse(rawParams) }
  prepared.set(ref, entry)
  return entry
}

/**
 * Run an effect for the given state, returning output(s) or `null`.
 * Params are resolved + parsed once per ref (see `prepareEffect`).
 */
export function applyEffect(
  ref: EffectRef,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): EffectOutput | readonly EffectOutput[] | null {
  const { def, params } = prepareEffect(ref)
  return def.apply(params, state, mode)
}

/**
 * Normalize an effect's single-or-array (or `null`) output into a flat array,
 * so consumers can iterate uniformly. A single {@link EffectOutput} is a tagged
 * object (a `Modifier` carries `stage`; a `GeneratorCostOutput` carries `kind`),
 * so the presence of either tag distinguishes it from an array.
 */
export function normalizeEffectOutputs(
  out: EffectOutput | readonly EffectOutput[] | null,
): readonly EffectOutput[] {
  if (!out) return []
  return 'stage' in out || 'kind' in out ? [out] : out
}
