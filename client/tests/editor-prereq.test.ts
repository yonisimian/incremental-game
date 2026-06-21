import { describe, expect, it } from 'vitest'
import { asSimplePrereq, fromSimplePrereq, type SimplePrereq } from '../src/dev/editor/inspector.js'

// The inspector's simple prerequisite form models "all/any of N upgrade ids,
// each with an optional minLevel". These two pure functions are the boundary
// between that form state and the engine's prerequisite expression — the
// round-trip below is what keeps authored JSON faithful to the form.

describe('asSimplePrereq', () => {
  it('maps undefined to an empty all-group', () => {
    expect(asSimplePrereq(undefined)).toEqual({ mode: 'all', items: [] })
  })

  it('maps a single upgrade to a one-item all-group', () => {
    expect(asSimplePrereq({ type: 'upgrade', id: 'a' })).toEqual({
      mode: 'all',
      items: [{ id: 'a', minLevel: undefined }],
    })
  })

  it('preserves a single upgrade minLevel', () => {
    expect(asSimplePrereq({ type: 'upgrade', id: 'a', minLevel: 5 })).toEqual({
      mode: 'all',
      items: [{ id: 'a', minLevel: 5 }],
    })
  })

  it('flattens an all-group of upgrades, keeping per-item minLevels', () => {
    expect(
      asSimplePrereq({
        type: 'all',
        items: [
          { type: 'upgrade', id: 'a' },
          { type: 'upgrade', id: 'b', minLevel: 3 },
        ],
      }),
    ).toEqual({
      mode: 'all',
      items: [
        { id: 'a', minLevel: undefined },
        { id: 'b', minLevel: 3 },
      ],
    })
  })

  it('flattens an any-group of upgrades', () => {
    expect(
      asSimplePrereq({
        type: 'any',
        items: [
          { type: 'upgrade', id: 'a' },
          { type: 'upgrade', id: 'b' },
        ],
      }),
    ).toEqual({
      mode: 'any',
      items: [
        { id: 'a', minLevel: undefined },
        { id: 'b', minLevel: undefined },
      ],
    })
  })

  it('returns null for a nested group it cannot represent', () => {
    expect(
      asSimplePrereq({
        type: 'all',
        items: [
          { type: 'upgrade', id: 'a' },
          { type: 'any', items: [{ type: 'upgrade', id: 'b' }] },
        ],
      }),
    ).toBeNull()
  })
})

describe('fromSimplePrereq', () => {
  it('maps an empty group to undefined', () => {
    expect(fromSimplePrereq({ mode: 'all', items: [] })).toBeUndefined()
  })

  it('collapses a single item to a bare upgrade expression', () => {
    expect(fromSimplePrereq({ mode: 'all', items: [{ id: 'a' }] })).toEqual({
      type: 'upgrade',
      id: 'a',
    })
  })

  it('keeps a minLevel above 1 on a single item', () => {
    expect(fromSimplePrereq({ mode: 'all', items: [{ id: 'a', minLevel: 4 }] })).toEqual({
      type: 'upgrade',
      id: 'a',
      minLevel: 4,
    })
  })

  it('drops a minLevel of 1 (the "owned" default) to keep JSON terse', () => {
    expect(fromSimplePrereq({ mode: 'all', items: [{ id: 'a', minLevel: 1 }] })).toEqual({
      type: 'upgrade',
      id: 'a',
    })
  })

  it('builds a group expression for multiple items, dropping default levels', () => {
    expect(
      fromSimplePrereq({
        mode: 'any',
        items: [
          { id: 'a', minLevel: 1 },
          { id: 'b', minLevel: 2 },
        ],
      }),
    ).toEqual({
      type: 'any',
      items: [
        { type: 'upgrade', id: 'a' },
        { type: 'upgrade', id: 'b', minLevel: 2 },
      ],
    })
  })
})

describe('round-trip', () => {
  const cases: SimplePrereq[] = [
    { mode: 'all', items: [] },
    { mode: 'all', items: [{ id: 'a', minLevel: undefined }] },
    { mode: 'all', items: [{ id: 'a', minLevel: 5 }] },
    {
      mode: 'any',
      items: [
        { id: 'a', minLevel: undefined },
        { id: 'b', minLevel: 3 },
      ],
    },
  ]

  it.each(cases)('asSimplePrereq(fromSimplePrereq(%j)) is stable', (simple) => {
    expect(asSimplePrereq(fromSimplePrereq(simple))).toEqual(simple)
  })
})
