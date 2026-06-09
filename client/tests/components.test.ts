import { describe, expect, it } from 'vitest'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  getModeDefinition,
  getAvailableUpgrades,
} from '@game/shared'
import type { GameState } from '../src/game.js'
import { renderUpgradeTree } from '../src/ui/components.js'

// ─── Test fixture helpers ────────────────────────────────────────────

const idlerDef = getModeDefinition('idler')

function makeIdlerState(playerOverrides: Partial<GameState['player']> = {}): GameState {
  const goal = { type: 'timed' as const, label: '⏱ Timed', durationSec: ROUND_DURATION_SEC }
  const upgrades = getAvailableUpgrades(idlerDef, goal)
  return {
    screen: 'playing',
    mode: 'idler',
    goal,
    player: {
      score: 0,
      resources: { r0: 0, r1: 0 },
      upgrades: Object.fromEntries(upgrades.map((u) => [u.id, 0])),
      generators: {},
      meta: { highlight: 'r0' },
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
    paused: false,
    vsBot: false,
    matchId: 'test-match',
    upgrades: [...upgrades],
    countdown: COUNTDOWN_SEC,
    endData: null,
    playerName: '',
    opponentName: '',
    roomCode: null,
    roomSettings: null,
    roomPlayers: [],
    isRoomCreator: false,
    serverActiveRooms: 0,
    roomError: null,
  }
}

// ─── renderUpgradeTree ───────────────────────────────────────────────

describe('renderUpgradeTree', () => {
  it('returns bounds enclosing all tree-node positions', () => {
    const { bounds } = renderUpgradeTree(makeIdlerState())
    // Timed goal excludes the trophy u5: uh(0,0), uh2(0,150), u1(200,0).
    expect(bounds.minX).toBe(0)
    expect(bounds.maxX).toBe(200)
    expect(bounds.minY).toBe(0)
    expect(bounds.maxY).toBe(150)
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
          cost: { r0: 0 },
          purchaseLimit: 1,
          modifiers: [],
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

  it('emits one <line> edge per prerequisite link', () => {
    const { edgesSvg } = renderUpgradeTree(makeIdlerState())
    // Idler stub has a single prerequisite: uh2 requires uh → one edge.
    const lineCount = (edgesSvg.match(/<line\b/g) ?? []).length
    expect(lineCount).toBe(1)
  })

  it('marks one-shot owned upgrades with `.owned` class (no `disabled`)', () => {
    const state = makeIdlerState({
      resources: { r0: 9999, r1: 9999 },
      upgrades: {
        ...Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
        u1: 1, // one-shot, owned
      },
    })
    const { nodes } = renderUpgradeTree(state)
    expect(nodes).toMatch(/class="upgrade-btn tree-node owned"[^>]*data-upgrade="u1"/)
    expect(nodes).not.toContain('disabled')
  })

  it('marks unlocked-but-broke nodes with `.too-expensive`, not `.locked`', () => {
    const state = makeIdlerState({
      resources: { r0: 0, r1: 0 }, // no money for any unlocked root
      // both roots have no prereqs → unlocked
    })
    const { nodes } = renderUpgradeTree(state)
    expect(nodes).toMatch(/class="upgrade-btn tree-node too-expensive"[^>]*data-upgrade="u1"/)
    // Same node should NOT carry `.locked` (priority ordering)
    expect(nodes).not.toMatch(/class="upgrade-btn tree-node locked"[^>]*data-upgrade="u1"/)
  })

  it('renders each tree node as an icon-only button with an accessible label', () => {
    const { nodes } = renderUpgradeTree(makeIdlerState())
    // Every node carries an icon span and an aria-label (the name).
    expect(nodes).toContain('class="tree-node-icon"')
    expect(nodes).toMatch(/data-upgrade="u1"[^>]*aria-label="[^"]+"/)
    // No textual name/cost/description spans on tree nodes anymore.
    expect(nodes).not.toContain('upgrade-name')
    expect(nodes).not.toContain('upgrade-cost')
    expect(nodes).not.toContain('upgrade-desc')
  })

  it('shows a ✓ badge on fully-owned tree nodes', () => {
    const state = makeIdlerState({
      resources: { r0: 9999, r1: 9999 },
      upgrades: {
        ...Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
        u1: 1, // one-shot, owned → maxed
      },
    })
    const { nodes } = renderUpgradeTree(state)
    expect(nodes).toContain('class="tree-node-badge"')
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
          cost: { r0: 0 },
          purchaseLimit: 1,
          modifiers: [],
          position: { x: 0, y: 0 },
        },
        {
          id: 'dst',
          cost: { r0: 0 },
          purchaseLimit: 1,
          modifiers: [],
          position: { x: 50, y: 0 }, // length 50 < 2 * 60 = 120
          prerequisites: { type: 'all', items: [{ type: 'upgrade', id: 'src' }] },
        },
      ],
    }
    synthetic.player.upgrades = { src: 0, dst: 0 }
    const { edgesSvg } = renderUpgradeTree(synthetic)
    expect(edgesSvg).toBe('') // no <line> emitted
  })
})
