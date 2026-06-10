import type { ZodType } from 'zod'

import type { Modifier } from '../modifiers/types.js'
import type { PlayerState } from '../types.js'

/**
 * A registered effect: a zod schema describing its params, plus how to turn
 * parsed params into a modifier at runtime.
 *
 * The schema is the single source of truth for an effect's param shape: the
 * registry validates raw refs against it (so malformed data is rejected at the
 * trust boundary), and the Phase 6 editor can introspect it to generate a form.
 */
export interface EffectDef<P> {
  /**
   * Validates a ref's params (the ref minus its `type` discriminant) and narrows
   * them to `P`. Throws (`ZodError`) on malformed input.
   */
  readonly schema: ZodType<P>
  /** Pure: produce a modifier from params + state, or `null` when inactive. */
  readonly apply: (params: P, state: Readonly<PlayerState>) => Modifier | null
}
