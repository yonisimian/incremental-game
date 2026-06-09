import { registerEffect } from './registry.js'
import { highlightMultiplier } from './seed/highlight-multiplier.js'

// Register seed effects exactly once, at module load.
registerEffect('highlightMultiplier', highlightMultiplier)

export type { EffectDef } from './types.js'
export { applyEffect, prepareEffect, registerEffect, resolveEffect } from './registry.js'
export type { HighlightMultiplierParams } from './seed/highlight-multiplier.js'
