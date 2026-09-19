/**
 * Plan 38 — attack slots on the client: the `held / limit` line in the attack
 * panel's section headings, and the slot-blocked node state in the tree.
 *
 * Node tier, not DOM: both render by assigning one HTML string, so a stub
 * container is enough to fail truthfully (see testing.instructions.md).
 *
 * The idler is re-registered with its active budget squeezed to one slot so the
 * cap is reachable with a single free unlock. Vitest isolates test files, so the
 * augmented registration cannot leak into any other suite.
 */

import { describe, expect, it } from 'vitest'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  createInitialState,
  getModeDefinition,
  registerMode,
} from '@game/shared'
import type { ModeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'
import { renderUpgradeTree } from '../src/ui/components.js'
import { canBuy, isAttackSlotBlocked } from '../src/ui/helpers.js'
import { attackPanel } from '../src/ui/panels/attack-panel.js'

// ─── Mode with a one-slot active budget ──────────────────────────────

const base = getModeDefinition('idler')

/** The idler's base grants minus every `attackSlots`, so a test can set its own. */
const uncappedEffects = (base.effects ?? []).filter((e) => e.type !== 'attackSlots')

function register(mode: ModeDefinition): ModeDefinition {
  registerMode('idler', mode)
  return getModeDefinition('idler')
}

const ONE_ACTIVE: ModeDefinition = {
  ...base,
  effects: [
    ...uncappedEffects,
    { type: 'attackSlots', attackKind: 'active', value: 1 },
    { type: 'attackSlots', attackKind: 'passive', value: 4 },
  ],
}
/**
 * No `attackSlots` anywhere — a kind is capped once *any* grant names it, so the
 * tree's slot upgrades have to go too, not just the mode-level base.
 */
const UNCAPPED: ModeDefinition = {
  ...base,
  effects: uncappedEffects,
  upgrades: base.upgrades.map((u) => ({
    ...u,
    effects: u.effects?.filter((e) => e.type !== 'attackSlots'),
  })),
}

/** The idler's free unlock node for `attack`. */
function unlockOf(mode: ModeDefinition, attack: string): string {
  return mode.upgrades.find((u) =>
    u.effects?.some((e) => e.type === 'unlockAttack' && e.attack === attack),
  )!.id
}

const panelUpgrade = base.upgrades.find((u) =>
  u.effects?.some((e) => e.type === 'panelUnlock' && e.panel === 'attack'),
)!.id
const A0 = unlockOf(base, 'a0')
const A1 = unlockOf(base, 'a1')
/** a2 is the tree's first passive. */
const P0 = unlockOf(base, 'a2')
/** A node with no unlock at all — never slot-blocked. */
const PLAIN = 'sc-unlock'

/** A playing state on `mode` with the attack panel open and `owned` nodes held. */
function makeState(mode: ModeDefinition, owned: Record<string, number>): GameState {
  const player = createInitialState(mode)
  player.resources.r0 = 1e6
  player.resources.r1 = 1e6
  player.upgrades[panelUpgrade] = 1
  Object.assign(player.upgrades, owned)
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC },
    player,
    opponent: { score: 0, resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    incomingAttacks: [],
    debuffs: [],
    timeLeft: ROUND_DURATION_SEC,
    paused: false,
    vsBot: false,
    matchId: 'test-match',
    upgrades: mode.upgrades,
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

function panelHtml(state: GameState): string {
  const container = { innerHTML: '' } as HTMLElement
  attackPanel.render(container, state)
  return container.innerHTML
}

/** The class list of one rendered tree node. */
function nodeClass(state: GameState, id: string): string {
  const { nodes } = renderUpgradeTree(state)
  const match = new RegExp(`class="([^"]*)"[^>]*data-upgrade="${id}"`, 'u').exec(nodes)
  expect(match, `node '${id}' not rendered`).not.toBeNull()
  return match![1]
}

// ─── Attack panel headings ───────────────────────────────────────────

describe('attackPanel — slots line', () => {
  it('shows held / limit beside each capped kind’s heading', () => {
    const mode = register(ONE_ACTIVE)
    const html = panelHtml(makeState(mode, { [A0]: 1, [P0]: 1 }))
    expect(html).toContain('Active <span class="attack-slots">1 / 1</span>')
    expect(html).toContain('Passive <span class="attack-slots">1 / 4</span>')
  })

  it('prints no slots line in a mode that never caps the kind', () => {
    const mode = register(UNCAPPED)
    const html = panelHtml(makeState(mode, { [A0]: 1 }))
    expect(html).toContain('<h3 class="attack-heading">Active</h3>')
    expect(html).not.toContain('attack-slots')
  })
})

// ─── Tree node state + helpers ───────────────────────────────────────

describe('slot-blocked upgrades', () => {
  it('renders an unlock the budget refuses as locked, and canBuy agrees', () => {
    const mode = register(ONE_ACTIVE)
    const state = makeState(mode, { [A0]: 1 })
    const a1 = mode.upgrades.find((u) => u.id === A1)!
    expect(isAttackSlotBlocked(state, a1)).toBe(true)
    expect(canBuy(state, a1)).toBe(false)
    expect(nodeClass(state, A1)).toContain('locked')
  })

  it('leaves the same node buyable while a slot is free', () => {
    const mode = register(ONE_ACTIVE)
    const state = makeState(mode, {})
    const a1 = mode.upgrades.find((u) => u.id === A1)!
    expect(isAttackSlotBlocked(state, a1)).toBe(false)
    expect(canBuy(state, a1)).toBe(true)
    expect(nodeClass(state, A1)).not.toContain('locked')
  })

  it('never slot-blocks a node that unlocks nothing', () => {
    const mode = register(ONE_ACTIVE)
    const state = makeState(mode, { [A0]: 1 })
    const plain = mode.upgrades.find((u) => u.id === PLAIN)!
    expect(isAttackSlotBlocked(state, plain)).toBe(false)
  })

  it('keeps the passive budget independent of a full active one', () => {
    const mode = register(ONE_ACTIVE)
    const state = makeState(mode, { [A0]: 1 })
    const p0 = mode.upgrades.find((u) => u.id === P0)!
    expect(isAttackSlotBlocked(state, p0)).toBe(false)
  })
})
