import { describe, expect, it } from 'vitest'
import { asSimplePrereq, fromSimplePrereq, type SimplePrereq } from '../src/dev/editor/inspector.js'

// The inspector's simple prerequisite form models "all/any of N upgrade ids,
// each with an optional minLevel", plus one checkbox for the tree's `meta` gate
// ("hit by an enemy attack"). These two pure functions are the boundary
// between that form state and the engine's prerequisite expression — the
// round-trip below is what keeps authored JSON faithful to the form.

const HIT = { type: 'meta' as const, key: 'attacksSuffered' as const, min: 1 }

describe('asSimplePrereq', () => {
  it('maps undefined to an empty all-group', () => {
    expect(asSimplePrereq(undefined)).toEqual({ mode: 'all', items: [], hitByAttack: false })
  })

  it('maps a single upgrade to a one-item all-group', () => {
    expect(asSimplePrereq({ type: 'upgrade', id: 'a' })).toEqual({
      mode: 'all',
      items: [{ id: 'a', minLevel: undefined }],
      hitByAttack: false,
    })
  })

  it('preserves a single upgrade minLevel', () => {
    expect(asSimplePrereq({ type: 'upgrade', id: 'a', minLevel: 5 })).toEqual({
      mode: 'all',
      items: [{ id: 'a', minLevel: 5 }],
      hitByAttack: false,
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
      hitByAttack: false,
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
      hitByAttack: false,
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

  describe('the hit-by-attack gate', () => {
    it('reads a bare gate as the checkbox alone', () => {
      expect(asSimplePrereq(HIT)).toEqual({ mode: 'all', items: [], hitByAttack: true })
    })

    it('reads all-of [upgrades…, gate] as the checklist plus the checkbox', () => {
      expect(
        asSimplePrereq({
          type: 'all',
          items: [{ type: 'upgrade', id: 'a' }, HIT, { type: 'upgrade', id: 'b', minLevel: 2 }],
        }),
      ).toEqual({
        mode: 'all',
        items: [
          { id: 'a', minLevel: undefined },
          { id: 'b', minLevel: 2 },
        ],
        hitByAttack: true,
      })
    })

    it('reads all-of [any(upgrades…), gate] as an any-checklist plus the checkbox', () => {
      expect(
        asSimplePrereq({
          type: 'all',
          items: [
            {
              type: 'any',
              items: [
                { type: 'upgrade', id: 'a' },
                { type: 'upgrade', id: 'b' },
              ],
            },
            HIT,
          ],
        }),
      ).toEqual({
        mode: 'any',
        items: [
          { id: 'a', minLevel: undefined },
          { id: 'b', minLevel: undefined },
        ],
        hitByAttack: true,
      })
    })

    it('falls back to JSON for any other meta gate or a doubled one', () => {
      expect(asSimplePrereq({ ...HIT, min: 2 })).toBeNull()
      expect(asSimplePrereq({ type: 'all', items: [HIT, HIT] })).toBeNull()
      expect(asSimplePrereq({ type: 'any', items: [{ type: 'upgrade', id: 'a' }, HIT] })).toBeNull()
    })
  })
})

describe('fromSimplePrereq', () => {
  it('maps an empty group to undefined', () => {
    expect(fromSimplePrereq({ mode: 'all', items: [], hitByAttack: false })).toBeUndefined()
  })

  it('collapses a single item to a bare upgrade expression', () => {
    expect(fromSimplePrereq({ mode: 'all', items: [{ id: 'a' }], hitByAttack: false })).toEqual({
      type: 'upgrade',
      id: 'a',
    })
  })

  it('keeps a minLevel above 1 on a single item', () => {
    expect(
      fromSimplePrereq({ mode: 'all', items: [{ id: 'a', minLevel: 4 }], hitByAttack: false }),
    ).toEqual({
      type: 'upgrade',
      id: 'a',
      minLevel: 4,
    })
  })

  it('drops a minLevel of 1 (the "owned" default) to keep JSON terse', () => {
    expect(
      fromSimplePrereq({ mode: 'all', items: [{ id: 'a', minLevel: 1 }], hitByAttack: false }),
    ).toEqual({
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
        hitByAttack: false,
      }),
    ).toEqual({
      type: 'any',
      items: [
        { type: 'upgrade', id: 'a' },
        { type: 'upgrade', id: 'b', minLevel: 2 },
      ],
    })
  })

  describe('the hit-by-attack gate', () => {
    it('is the bare gate with an empty checklist', () => {
      expect(fromSimplePrereq({ mode: 'all', items: [], hitByAttack: true })).toEqual(HIT)
    })

    it('ANDs onto an all-checklist flat, and onto an any-checklist as one member', () => {
      expect(
        fromSimplePrereq({ mode: 'all', items: [{ id: 'a' }, { id: 'b' }], hitByAttack: true }),
      ).toEqual({
        type: 'all',
        items: [{ type: 'upgrade', id: 'a' }, { type: 'upgrade', id: 'b' }, HIT],
      })
      expect(
        fromSimplePrereq({ mode: 'any', items: [{ id: 'a' }, { id: 'b' }], hitByAttack: true }),
      ).toEqual({
        type: 'all',
        items: [
          {
            type: 'any',
            items: [
              { type: 'upgrade', id: 'a' },
              { type: 'upgrade', id: 'b' },
            ],
          },
          HIT,
        ],
      })
      expect(fromSimplePrereq({ mode: 'any', items: [{ id: 'a' }], hitByAttack: true })).toEqual({
        type: 'all',
        items: [{ type: 'upgrade', id: 'a' }, HIT],
      })
    })
  })
})

describe('round-trip', () => {
  const cases: SimplePrereq[] = [
    { mode: 'all', items: [], hitByAttack: false },
    { mode: 'all', items: [{ id: 'a', minLevel: undefined }], hitByAttack: false },
    { mode: 'all', items: [{ id: 'a', minLevel: 5 }], hitByAttack: false },
    {
      mode: 'any',
      items: [
        { id: 'a', minLevel: undefined },
        { id: 'b', minLevel: 3 },
      ],
      hitByAttack: false,
    },
    { mode: 'all', items: [], hitByAttack: true },
    { mode: 'all', items: [{ id: 'a', minLevel: undefined }], hitByAttack: true },
    {
      mode: 'all',
      items: [
        { id: 'a', minLevel: undefined },
        { id: 'b', minLevel: 2 },
      ],
      hitByAttack: true,
    },
    {
      mode: 'any',
      items: [
        { id: 'a', minLevel: undefined },
        { id: 'b', minLevel: undefined },
      ],
      hitByAttack: true,
    },
  ]

  it.each(cases)('asSimplePrereq(fromSimplePrereq(%j)) is stable', (simple) => {
    expect(asSimplePrereq(fromSimplePrereq(simple))).toEqual(simple)
  })
})
