import type { Modifier } from '../modifiers/types.js'
import type { EffectRef, PlayerState } from '../types.js'

/**
 * A registered effect: how to validate its raw params and how to turn them into
 * a modifier at runtime.
 *
 * `parse` deliberately mirrors zod's `.parse(raw) => P` signature. Today params
 * are TS-authored and compiler-checked, so a hand-rolled guard is enough; when
 * the Phase 4 JSON boundary introduces untrusted input, a schema's `.parse` can
 * be slotted in here with no change to call sites.
 */
export interface EffectDef<P> {
  /** Validate and narrow a raw ref into typed params. Throws on malformed input. */
  readonly parse: (raw: EffectRef) => P
  /** Pure: produce a modifier from params + state, or `null` when inactive. */
  readonly apply: (params: P, state: Readonly<PlayerState>) => Modifier | null
}
