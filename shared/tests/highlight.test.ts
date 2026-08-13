import { describe, expect, it } from 'vitest'
import { readHighlight } from '../src/highlight.js'
import type { PlayerState } from '../src/types.js'

function makeState(meta: Record<string, unknown>): PlayerState {
  return { score: 0, resources: {}, upgrades: {}, generators: {}, pendingAttacks: [], meta }
}

describe('readHighlight', () => {
  it('reads the highlighted resource key', () => {
    expect(readHighlight(makeState({ highlight: 'r1' }))).toBe('r1')
  })

  it('reads an explicit release as null', () => {
    expect(readHighlight(makeState({ highlight: null }))).toBeNull()
  })

  it('reads an absent key as null', () => {
    expect(readHighlight(makeState({}))).toBeNull()
  })

  it('reads a non-string value as null', () => {
    // `meta` is `unknown`-valued, so a malformed snapshot must degrade to
    // "nothing highlighted" rather than leaking a number into a resource key.
    expect(readHighlight(makeState({ highlight: 7 }))).toBeNull()
  })
})
