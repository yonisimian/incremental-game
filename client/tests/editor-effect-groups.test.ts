import { describe, expect, it } from 'vitest'
import { listEffectTypes } from '@game/shared'
import { EFFECT_GROUPS, groupEffectTypes } from '../src/dev/editor/inspector.js'

describe('groupEffectTypes', () => {
  it('places known types in their declared group, in order', () => {
    const groups = groupEffectTypes(['relativeModifier', 'baseModifier', 'highlightMultiplier'])
    const production = groups.find((g) => g.label === 'Production')
    const highlight = groups.find((g) => g.label === 'Highlight')
    expect(production?.types).toEqual(['baseModifier', 'relativeModifier'])
    expect(highlight?.types).toEqual(['highlightMultiplier'])
  })

  it('collects unrecognised types into a sorted Other group', () => {
    const groups = groupEffectTypes(['zeta', 'baseModifier', 'alpha'])
    const other = groups.find((g) => g.label === 'Other')
    expect(other?.types).toEqual(['alpha', 'zeta'])
  })

  it('omits groups with no available members', () => {
    const groups = groupEffectTypes(['baseModifier'])
    expect(groups.map((g) => g.label)).toEqual(['Production'])
  })

  it('partitions every registered type exactly once', () => {
    const all = listEffectTypes()
    const groups = groupEffectTypes(all)
    const flattened = groups.flatMap((g) => g.types)
    expect([...flattened].sort()).toEqual([...all].sort())
    expect(flattened.length).toBe(new Set(flattened).size)
  })
})

// Drift guard: the `Other` fallback keeps the picker working at runtime even if
// EFFECT_GROUPS falls out of sync with the registry, which would otherwise let
// the table rot silently. These assertions force the explicit grouping to stay
// exhaustive and current — they fail when a new effect is added without being
// categorised, or when a removed effect leaves a stale entry behind.
describe('EFFECT_GROUPS stays in sync with the registry', () => {
  const declared = EFFECT_GROUPS.flatMap((g) => g.types)

  it('categorises every registered effect (no silent "Other" bucket)', () => {
    const groups = groupEffectTypes(listEffectTypes())
    const other = groups.find((g) => g.label === 'Other')
    expect(other?.types ?? []).toEqual([])
  })

  it('lists no effect that is not registered (no stale entries)', () => {
    const registered = new Set(listEffectTypes())
    expect(declared.filter((t) => !registered.has(t))).toEqual([])
  })

  it('lists each effect in exactly one group', () => {
    expect(declared.length).toBe(new Set(declared).size)
  })
})
