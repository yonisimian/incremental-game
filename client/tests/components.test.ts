import { describe, expect, it } from 'vitest'
import { COUNTDOWN_SEC, ROUND_DURATION_SEC, getModeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'
import { renderUpgradeTree } from '../src/ui/components.js'

// ─── Test fixture helpers ────────────────────────────────────────────

const idlerDef = getModeDefinition('idler')

function makeIdlerState(playerOverrides: Partial<GameState['player']> = {}): GameState {
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', durationSec: ROUND_DURATION_SEC },
    player: {
      score: 0,
      resources: { wood: 0, ale: 0 },
      upgrades: Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
      generators: {},
      meta: { highlight: 'wood' },
      ...playerOverrides,
    },
    opponent: {
      score: 0,
      resources: {},
      upgrades: {},
      generators: {},
      meta: {},
    },
    timeLeft: ROUND_DURATION_SEC,
    matchId: 'test-match',
    upgrades: [...idlerDef.upgrades],
    countdown: COUNTDOWN_SEC,
    endData: null,
    playerName: '',
    opponentName: '',
  }
}

// ─── renderUpgradeTree ───────────────────────────────────────────────

describe('renderUpgradeTree', () => {
  it('returns bounds enclosing all tree-node positions', () => {
    const { bounds } = renderUpgradeTree(makeIdlerState())
    // Current idler tree positions: heavy(0,0), royal(400,0), master(500,200), industrial(200,400)
    expect(bounds.minX).toBe(0)
    expect(bounds.maxX).toBe(500)
    expect(bounds.minY).toBe(0)
    expect(bounds.maxY).toBe(400)
  })

  it('anchors bounds on actual node positions, not on origin (0,0)', () => {
    // Regression guard for the Infinity-sentinel fix: when no node sits at the
    // origin, bounds must enclose the actual nodes rather than stretching from
    // (0,0) to the nearest extreme.
    const state: GameState = {
      ...makeIdlerState(),
      upgrades: [
        {
          id: 'far-node',
          name: 'Far',
          cost: 0,
          description: '',
          modifiers: [],
          category: 'tree',
          position: { x: 500, y: 500 },
        },
      ],
    }
    state.player.upgrades = { 'far-node': 0 }
    const { bounds } = renderUpgradeTree(state)
    expect(bounds).toEqual({ minX: 500, maxX: 500, minY: 500, maxY: 500 })
  })

  it('falls back to (0,0,0,0) bounds when there are no tree nodes', () => {
    const state: GameState = { ...makeIdlerState(), upgrades: [] }
    state.player.upgrades = {}
    const { bounds } = renderUpgradeTree(state)
    expect(bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
  })

  it('emits one <line> per prereq edge in the idler tree', () => {
    const { edgesSvg } = renderUpgradeTree(makeIdlerState())
    // 1 edge: master-craftsmen ← royal-brewery
    // 2 edges: industrial-era ← heavy-logging, industrial-era ← royal-brewery
    const lineCount = (edgesSvg.match(/<line\b/g) ?? []).length
    expect(lineCount).toBe(3)
  })

  it('marks line as `unlocked` only when child node is unlocked', () => {
    // No prereqs owned → no edges should be marked unlocked
    const lockedTree = renderUpgradeTree(makeIdlerState())
    expect(lockedTree.edgesSvg).not.toContain('class="unlocked"')

    // royal-brewery owned → master-craftsmen edge becomes unlocked
    const partial = renderUpgradeTree(
      makeIdlerState({
        upgrades: {
          ...Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
          'royal-brewery': 1,
        },
      }),
    )
    const unlockedCount = (partial.edgesSvg.match(/class="unlocked"/g) ?? []).length
    expect(unlockedCount).toBe(1)
  })

  it('emits a button with `.locked` for each tree node when prerequisites are unowned', () => {
    const { nodes } = renderUpgradeTree(makeIdlerState())
    // master-craftsmen + industrial-era have prereqs → both .locked
    expect(nodes).toMatch(/data-upgrade="master-craftsmen"[^>]*\sdisabled\b/)
    expect(nodes).toMatch(/data-upgrade="industrial-era"[^>]*\sdisabled\b/)
    // .locked class is applied to those nodes
    const lockedCount = (nodes.match(/class="upgrade-btn tree-node locked"/g) ?? []).length
    expect(lockedCount).toBe(2)
  })

  it('marks one-shot owned upgrades with `.owned` class and disables them', () => {
    const state = makeIdlerState({
      resources: { wood: 9999, ale: 9999 },
      upgrades: {
        ...Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
        'heavy-logging': 1, // one-shot, owned
      },
    })
    const { nodes } = renderUpgradeTree(state)
    expect(nodes).toMatch(
      /class="upgrade-btn tree-node owned"[^>]*data-upgrade="heavy-logging"[^>]*\sdisabled\b/,
    )
  })

  it('marks unlocked-but-broke nodes with `.too-expensive` (and disables), not `.locked`', () => {
    const state = makeIdlerState({
      resources: { wood: 0, ale: 0 }, // no money for any unlocked root
      // both roots have no prereqs → unlocked
    })
    const { nodes } = renderUpgradeTree(state)
    expect(nodes).toMatch(
      /class="upgrade-btn tree-node too-expensive"[^>]*data-upgrade="heavy-logging"/,
    )
    // Same node should NOT carry `.locked` (priority ordering)
    expect(nodes).not.toMatch(
      /class="upgrade-btn tree-node locked"[^>]*data-upgrade="heavy-logging"/,
    )
  })

  it('does not emit any `.upgrade-hotkey` span on tree nodes', () => {
    // Regression guard: tree-panel hotkey labels were removed in favour of
    // future generic hotkeys (buy-cheapest / buy-all). See TODO.md.
    const { nodes } = renderUpgradeTree(makeIdlerState())
    expect(nodes).not.toContain('upgrade-hotkey')
  })

  it('skips degenerate edges where source and dest centers are too close', () => {
    // Build a synthetic state with two tree upgrades whose positions are
    // closer than 2 * NODE_CLEARANCE (60). Dest's prereq edge must be
    // skipped rather than rendered as a backwards stub.
    const synthetic: GameState = {
      ...makeIdlerState(),
      upgrades: [
        {
          id: 'src',
          name: 'src',
          cost: 0,
          description: '',
          modifiers: [],
          category: 'tree',
          position: { x: 0, y: 0 },
        },
        {
          id: 'dst',
          name: 'dst',
          cost: 0,
          description: '',
          modifiers: [],
          category: 'tree',
          position: { x: 50, y: 0 }, // length 50 < 2 * 60 = 120
          prerequisites: ['src'],
        },
      ],
    }
    synthetic.player.upgrades = { src: 0, dst: 0 }
    const { edgesSvg } = renderUpgradeTree(synthetic)
    expect(edgesSvg).toBe('') // no <line> emitted
  })
})
