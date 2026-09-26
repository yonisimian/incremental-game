/**
 * Reading the highlight selection.
 *
 * `meta.highlight` is mode-specific metadata, so the engine sees it as
 * `unknown`. This module is the single reader, so every consumer agrees on one
 * parse — and on there being no fallback resource: an absent selection means
 * "nothing highlighted", never a silent boost to some default.
 *
 * Releasing the highlight is a real player choice (and the precondition for any
 * mechanic that charges for holding one), so **`null` is a first-class value**,
 * not an error case. This module is the single reader; it deliberately has no
 * mode dependency so effect implementations can use it without a cycle back
 * through `modes/`.
 */

import type { PlayerState } from './types.js'

/**
 * The resource this player currently highlights, or `null` for "nothing
 * highlighted".
 *
 * Absent, `null`, and any non-string value all read as `null` — the wire and the
 * `initialMeta` authoring surface both carry `unknown`, so a missing key and an
 * explicit release must mean the same thing rather than diverging by accident.
 */
export function readHighlight(state: Readonly<PlayerState>): string | null {
  const highlight = state.meta.highlight
  return typeof highlight === 'string' ? highlight : null
}
