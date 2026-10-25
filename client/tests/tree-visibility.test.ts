import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, getModeDefinition } from '@game/shared'
import type { PlayerState, UpgradeDefinition } from '@game/shared'
import { visibleUpgradeIds } from '../src/ui/tree-visibility.js'

// A small synthetic tree — the rule is about prerequisite shapes, not the real
// idler economy. The player owns `a` (level 1) and nothing else:
//
//   a (root) ─► b ─► c ─► d
//   and  = all(a, b)      or  = any(a, b)
//   lvl  = a level 2+     meta = 1 attack suffered
function upgrade(id: string, prerequisites?: UpgradeDefinition['prerequisites']) {
  return { id, cost: {}, purchaseLimit: 1, prerequisites } satisfies UpgradeDefinition
}

const tree: UpgradeDefinition[] = [
  upgrade('a'),
  upgrade('b', { type: 'upgrade', id: 'a' }),
  upgrade('c', { type: 'upgrade', id: 'b' }),
  upgrade('d', { type: 'upgrade', id: 'c' }),
  upgrade('and', {
    type: 'all',
    items: [
      { type: 'upgrade', id: 'a' },
      { type: 'upgrade', id: 'b' },
    ],
  }),
  upgrade('or', {
    type: 'any',
    items: [
      { type: 'upgrade', id: 'a' },
      { type: 'upgrade', id: 'b' },
    ],
  }),
  upgrade('lvl', { type: 'upgrade', id: 'a', minLevel: 2 }),
  upgrade('meta', { type: 'meta', key: 'attacksSuffered', min: 1 }),
]

function player(): PlayerState {
  const state = createInitialState(getModeDefinition('idler'))
  state.upgrades = { a: 1 }
  return state
}

const sorted = (ids: ReadonlySet<string>) => [...ids].sort()

describe('visibleUpgradeIds', () => {
  it('full shows every upgrade', () => {
    expect(sorted(visibleUpgradeIds({ upgrades: tree, player: player() }, 'full'))).toEqual(
      tree.map((u) => u.id).sort(),
    )
  })

  it('hidden shows only upgrades whose prerequisites are met', () => {
    // a is a root; b and or are met by owning a. c needs b, and needs b,
    // lvl needs a at level 2, meta needs an attack.
    expect(sorted(visibleUpgradeIds({ upgrades: tree, player: player() }, 'hidden'))).toEqual([
      'a',
      'b',
      'or',
    ])
  })

  it('peek adds the children of revealed upgrades, but not their grandchildren', () => {
    const visible = visibleUpgradeIds({ upgrades: tree, player: player() }, 'peek')
    // c is a child of the revealed b; and and lvl each have a revealed parent.
    expect(sorted(visible)).toEqual(['a', 'and', 'b', 'c', 'lvl', 'or'])
    expect(visible.has('d')).toBe(false)
  })

  it('peeks an AND child with one parent still unmet', () => {
    const onlyA = tree.filter((u) => u.id !== 'b')
    // With b gone, `and` can never be met, but its revealed parent a still peeks it.
    expect(visibleUpgradeIds({ upgrades: onlyA, player: player() }, 'hidden').has('and')).toBe(
      false,
    )
    expect(visibleUpgradeIds({ upgrades: onlyA, player: player() }, 'peek').has('and')).toBe(true)
  })

  it('never peeks a meta-gated upgrade, which has no upgrade parent', () => {
    expect(visibleUpgradeIds({ upgrades: tree, player: player() }, 'peek').has('meta')).toBe(false)
    const hit = player()
    hit.meta = { ...hit.meta, attacksSuffered: 1 }
    expect(visibleUpgradeIds({ upgrades: tree, player: hit }, 'hidden').has('meta')).toBe(true)
  })

  it('reveals a minLevel child once the parent reaches the level', () => {
    const levelled = player()
    levelled.upgrades = { a: 2 }
    expect(visibleUpgradeIds({ upgrades: tree, player: levelled }, 'hidden').has('lvl')).toBe(true)
  })
})

describe('tree visibility setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function loadWith(stored: string | null) {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem })
    // Fresh module instance so its top-level load runs with the stub.
    vi.resetModules()
    const mod = await import('../src/ui/tree-visibility.js')
    return { ...mod, setItem }
  }

  it('defaults to full when nothing is stored', async () => {
    const { getTreeVisibility } = await loadWith(null)
    expect(getTreeVisibility()).toBe('full')
  })

  it('falls back to full for an unknown stored value', async () => {
    const { getTreeVisibility } = await loadWith('everything')
    expect(getTreeVisibility()).toBe('full')
  })

  it('reads a stored mode', async () => {
    const { getTreeVisibility } = await loadWith('peek')
    expect(getTreeVisibility()).toBe('peek')
  })

  it('persists a new mode', async () => {
    const { getTreeVisibility, setTreeVisibility, setItem } = await loadWith(null)
    setTreeVisibility('hidden')
    expect(getTreeVisibility()).toBe('hidden')
    expect(setItem).toHaveBeenCalledWith('tree-visibility', 'hidden')
  })
})
