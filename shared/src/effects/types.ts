import type { ZodType } from 'zod'

import type { Modifier } from '../modifiers/types.js'
import type { ModeDefinition } from '../modes/types.js'
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
  /**
   * Pure: produce modifier(s) from params + state + mode, or `null` when inactive.
   *
   * Returns a single `Modifier`, an array (for effects that touch several fields
   * at once, e.g. generator-synergy effects), or `null`. The `mode` argument
   * gives topology-aware effects access to the generator list and resource keys.
   */
  readonly apply: (
    params: P,
    state: Readonly<PlayerState>,
    mode: ModeDefinition,
  ) => Modifier | readonly Modifier[] | null
}
