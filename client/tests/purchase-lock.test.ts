// The client surfaces that report an incoming *purchase lock* to its
// victim: the tree node's state class, the generator card's buy buttons (with
// selling left live), and the standing warning in the enemy-data panel.
//
// Node tier: every assertion is on rendered markup / a returned string, as the
// cost-inflation suite's are. The popup's Buy button is the DOM-tier twin
// (`purchase-lock.dom.test.ts`).

import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  generatorCostCurrency,
  getModeDefinition,
  getModeFlavor,
} from '@game/shared'
import type { PurchaseLock, UpgradeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'
import { renderUpgradeTree } from '../src/ui/components.js'
import { canBuy, isPurchaseLockedByAttack, purchaseLockLabel } from '../src/ui/helpers.js'
import { espionagePanel } from '../src/ui/panels/espionage-panel.js'
import { generatorsPanel } from '../src/ui/panels/generators-panel.js'

const modeDef = getModeDefinition('idler')
const flavor = getModeFlavor(modeDef)

/** The victim's clock, so a lock `untilSec` of 27.5 reads as 7.5s left. */
const GAME_SEC = 20
const UNTIL = 27.5

const LOCK_UPGRADES: PurchaseLock[] = [{ scope: 'upgrade', untilSec: UNTIL }]
const LOCK_GENERATORS: PurchaseLock[] = [{ scope: 'generator', untilSec: UNTIL }]
const LOCK_BOTH: PurchaseLock[] = [...LOCK_UPGRADES, ...LOCK_GENERATORS]

/** A free, prerequisite-less upgrade — buyable unless something *else* says no. */
const FREE: UpgradeDefinition = {
  id: 'u-free',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 1,
  position: { x: 0, y: 0 },
}

function makeState(locks?: PurchaseLock[]): GameState {
  const player = createInitialState(modeDef)
  player.resources.r0 = 1e6
  player.resources.r1 = 1e6
  player.meta.gameSec = GAME_SEC
  if (locks) player.incomingPurchaseLocks = locks
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: 60 },
    player,
    opponent: { resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    incomingAttacks: [],
    debuffs: [],
    timeLeft: 60,
    paused: false,
    vsBot: false,
    matchId: null,
    upgrades: [FREE],
    countdown: 0,
    endData: null,
    playerName: 'p1',
    opponentName: 'p2',
    roomCode: null,
    roomSettings: null,
    roomPlayers: [],
    isRoomCreator: false,
    serverActiveRooms: 0,
    roomError: null,
  }
}

describe('helpers', () => {
  it('reads the lock per scope and counts it down on the game clock', () => {
    const state = makeState(LOCK_UPGRADES)
    expect(isPurchaseLockedByAttack(state, 'upgrade')).toBe(true)
    expect(isPurchaseLockedByAttack(state, 'generator')).toBe(false)
    expect(purchaseLockLabel(state, 'upgrade')).toBe('🔒 Locked 7.5s')
    expect(isPurchaseLockedByAttack(makeState(), 'upgrade')).toBe(false)
  })

  // `canBuy` feeds the `C` buy-all hotkey and the node class, so a buy the
  // server will drop must read as not buyable here.
  it('makes a free, unlocked upgrade unbuyable under an upgrade lock only', () => {
    expect(canBuy(makeState(), FREE)).toBe(true)
    expect(canBuy(makeState(LOCK_UPGRADES), FREE)).toBe(false)
    expect(canBuy(makeState(LOCK_GENERATORS), FREE)).toBe(true)
  })
})

describe('upgrade tree node', () => {
  const nodeClass = (state: GameState): string => {
    const { nodes } = renderUpgradeTree(state)
    const match = /class="upgrade-btn tree-node ?([a-z-]*)"/u.exec(nodes)
    return match?.[1] ?? ''
  }

  it('marks the node locked-by-attack under an upgrade lock, and nothing otherwise', () => {
    expect(nodeClass(makeState())).toBe('')
    expect(nodeClass(makeState(LOCK_UPGRADES))).toBe('locked-by-attack')
    // A generator lock says nothing about the tree.
    expect(nodeClass(makeState(LOCK_GENERATORS))).toBe('')
  })
})

describe('generator card', () => {
  const g0 = modeDef.generators[0]
  const costIcon = flavor.resources.find((r) => r.key === generatorCostCurrency(g0))!.icon

  /** The upgrade whose `generatorUnlock` effect gates `g0`. */
  const unlockId = modeDef.upgrades.find((u) =>
    (u.effects ?? []).some((e) => e.type === 'generatorUnlock' && e.generator === g0.id),
  )!.id

  /** The panel's markup for a player owning one `g0` (so buy *and* sell show). */
  function renderWithG0(locks?: PurchaseLock[]): string {
    const state = makeState(locks)
    state.player.upgrades[unlockId] = 1
    state.player.generators[g0.id] = 1
    const container = { innerHTML: '' } as HTMLElement
    generatorsPanel.render(container, state)
    return container.innerHTML
  }

  it('replaces both buy prices with the countdown and disables them, keeping Sell live', () => {
    const html = renderWithG0(LOCK_GENERATORS)
    expect(html).toContain('locked-by-attack')
    // Two buy buttons per card, every card the unlock reveals.
    const cards = html.match(/<article class="generator-card/gu)!.length
    expect(cards).toBeGreaterThan(0)
    expect(html.match(/🔒 Locked 7\.5s/gu)).toHaveLength(2 * cards)
    expect(html).not.toContain(`Buy 1 — ${costIcon}`)
    // Both buy buttons disabled…
    expect(html).toMatch(/data-action="buy" disabled/u)
    expect(html).toMatch(/data-action="buy-max" disabled/u)
    // …the sell button not: the lock is on spending.
    expect(html).toMatch(/data-action="sell" >/u)
    expect(html).toContain('Sell 1 —')
  })

  it('quotes prices as usual under an upgrade-only lock', () => {
    const html = renderWithG0(LOCK_UPGRADES)
    expect(html).not.toContain('🔒 Locked')
    expect(html).toContain(`Buy 1 — ${costIcon}`)
  })
})

describe('enemy-data panel — standing lock warning', () => {
  function render(state: GameState): string {
    const container = { innerHTML: '' } as HTMLElement
    espionagePanel.render(container, state)
    return container.innerHTML
  }

  it('warns for one scope, with no espionage researched', () => {
    const html = render(makeState(LOCK_UPGRADES))
    expect(html).toContain('espionage-warning')
    expect(html).toContain('🔒 You cannot buy upgrades for 7.5s.')
    expect(html).not.toContain('generators for')
    expect(html).toContain('No intel yet')
  })

  it('collapses both scopes into one sentence when they lift together', () => {
    const html = render(makeState(LOCK_BOTH))
    expect(html).toContain('🔒 You cannot buy upgrades or generators for 7.5s.')
    expect(html.match(/🔒/gu)).toHaveLength(1)
  })

  it('gives each scope its own line when the countdowns differ', () => {
    const html = render(
      makeState([
        { scope: 'upgrade', untilSec: 24 },
        { scope: 'generator', untilSec: 28 },
      ]),
    )
    expect(html).toContain('🔒 You cannot buy upgrades for 4.0s.')
    expect(html).toContain('🔒 You cannot buy generators for 8.0s.')
  })

  it('stays silent when no lock is in force', () => {
    expect(render(makeState())).not.toContain('🔒')
  })
})
