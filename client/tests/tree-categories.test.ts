import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAvailableUpgrades, getModeDefinition } from '@game/shared'
import type { ModeDefinition } from '@game/shared'
import { roundCategories, stepCategory } from '../src/ui/tree-categories.js'

describe('roundCategories', () => {
  const idler = getModeDefinition('idler')

  it('lists the categories in order, skipping one empty this round', () => {
    // A timed round drops the buy-upgrade trophy, the only upgrade in c0.
    const timed = getAvailableUpgrades(idler, { type: 'timed', label: 'T', durationSec: 60 })
    expect(roundCategories(idler, timed)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'])
  })

  it('keeps the trophy category when the goal includes it', () => {
    const race = getAvailableUpgrades(idler, {
      type: 'buy-upgrade',
      label: 'Race',
      safetyCapSec: 600,
    })
    expect(roundCategories(idler, race)[0]).toBe('c0')
  })

  it('is empty for a mode without categories', () => {
    const { categories: _categories, ...plain } = idler
    const mode: ModeDefinition = plain
    expect(roundCategories(mode, idler.upgrades)).toEqual([])
  })
})

describe('stepCategory', () => {
  const ids = ['a', 'b', 'c']

  it('steps to the neighbour', () => {
    expect(stepCategory(ids, 'b', 1)).toBe('c')
    expect(stepCategory(ids, 'b', -1)).toBe('a')
  })

  it('wraps around both ends', () => {
    expect(stepCategory(ids, 'c', 1)).toBe('a')
    expect(stepCategory(ids, 'a', -1)).toBe('c')
  })
})

describe('tree categories setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function loadWith(stored: string | null) {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem })
    // Fresh module instance so its top-level load runs with the stub.
    vi.resetModules()
    const mod = await import('../src/ui/tree-categories.js')
    return { ...mod, setItem }
  }

  it('defaults to off when nothing is stored', async () => {
    const { getTreeCategories } = await loadWith(null)
    expect(getTreeCategories()).toBe(false)
  })

  it('reads off for an unknown stored value', async () => {
    const { getTreeCategories } = await loadWith('yes')
    expect(getTreeCategories()).toBe(false)
  })

  it('reads a stored on', async () => {
    const { getTreeCategories } = await loadWith('on')
    expect(getTreeCategories()).toBe(true)
  })

  it('persists a change', async () => {
    const { getTreeCategories, setTreeCategories, setItem } = await loadWith(null)
    setTreeCategories(true)
    expect(getTreeCategories()).toBe(true)
    expect(setItem).toHaveBeenCalledWith('tree-categories', 'on')
  })
})
