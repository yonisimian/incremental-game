import { describe, expect, it } from 'vitest'

import {
  ensureFlavorEntry,
  getNodeFlavorValues,
  updateFlavorEntry,
} from '../src/dev/editor/inspector.js'

describe('editor flavor helpers', () => {
  it('prefers the flavor table values for a node when they exist', () => {
    const tree = {
      flavors: [
        {
          id: 'default',
          upgrades: [{ id: 'u1', name: 'Wood Axe', icon: '🪓', description: 'Cuts trees' }],
        },
      ],
    } as any

    expect(
      getNodeFlavorValues(tree, { id: 'u1', flavorName: 'Old', flavorIcon: 'x' } as any),
    ).toEqual({
      name: 'Wood Axe',
      icon: '🪓',
      description: 'Cuts trees',
    })
  })

  it('creates a flavor entry for a node when one is missing', () => {
    const entries: Array<{ id: string; name: string; icon: string; description: string }> = []

    const next = ensureFlavorEntry(entries, 'u1')

    expect(next).toEqual([
      {
        id: 'u1',
        name: 'u1',
        icon: '?',
        description: '',
      },
    ])
  })

  it('updates an existing flavor entry in place', () => {
    const entries: Array<{ id: string; name: string; icon: string; description: string }> = [
      { id: 'u1', name: 'Old', icon: 'x', description: 'desc' },
    ]

    const next = updateFlavorEntry(entries, 'u1', {
      name: 'Wood Axe',
      icon: '🪓',
      description: 'Cuts trees faster',
    })

    expect(next).toEqual([
      {
        id: 'u1',
        name: 'Wood Axe',
        icon: '🪓',
        description: 'Cuts trees faster',
      },
    ])
  })
})
