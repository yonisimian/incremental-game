// The three client surfaces that report an incoming *cost inflation* to its
// victim: the price quoted on an upgrade, the marker that explains why it's
// above the tree's number, and the standing warning in the enemy-data panel.
//
// Node tier: every assertion is on rendered markup / a returned string. The
// espionage panel writes its html in `render`, and neither the cost label nor
// the generator card reads a live element.

import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  generatorCostCurrency,
  getGeneratorCost,
  getGeneratorSellRefund,
  getModeDefinition,
  getModeFlavor,
  getResourceIcon,
} from '@game/shared'
import type { EnemyCostFactor, PactCostFactor, UpgradeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'
import {
  canAfford,
  DISCOUNTED_COST_MARKER,
  formatUpgradeCost,
  INFLATED_COST_MARKER,
} from '../src/ui/helpers.js'
import { formatNumber } from '../src/ui/format-number.js'
import { espionagePanel } from '../src/ui/panels/espionage-panel.js'
import { generatorsPanel } from '../src/ui/panels/generators-panel.js'

const modeDef = getModeDefinition('idler')
const flavor = getModeFlavor(modeDef)

/** A ×2 inflation on everything the player might buy. */
const DOUBLE_ALL: EnemyCostFactor[] = [
  { scope: 'upgrade', costFactor: 2 },
  { scope: 'generator', costFactor: 2 },
]

const UPGRADE: UpgradeDefinition = {
  id: 'u-test',
  cost: { r0: { baseCost: 100 } },
  purchaseLimit: 1,
}

/** A pact discount on the test upgrade and on the first generator (plan 42). */
const MIRRORED: PactCostFactor[] = [
  { pact: 'p2', scope: 'upgrade', id: 'u-test', costFactor: 0.75 },
  { pact: 'p3', scope: 'generator', id: 'g0', costFactor: 0.5 },
]

function makeState(incoming?: EnemyCostFactor[], discounts?: PactCostFactor[]): GameState {
  const player = createInitialState(modeDef)
  player.resources.r0 = 150
  if (incoming) player.incomingCostFactors = incoming
  if (discounts) player.pactCostFactors = discounts
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
    upgrades: modeDef.upgrades,
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

describe('upgrade price label', () => {
  it('quotes the inflated price, marked', () => {
    const label = formatUpgradeCost(makeState(DOUBLE_ALL), UPGRADE, flavor)
    expect(label).toContain('200')
    expect(label).toContain(INFLATED_COST_MARKER)
  })

  it('quotes the authored price unmarked when nobody is attacking', () => {
    const label = formatUpgradeCost(makeState(), UPGRADE, flavor)
    expect(label).toContain('100')
    expect(label).not.toContain(INFLATED_COST_MARKER)
  })

  // The card's affordability shading has to agree with the quote, or a node
  // reads as buyable at a price the server will refuse.
  it('shades affordability against the inflated price', () => {
    expect(canAfford(makeState(), UPGRADE)).toBe(true)
    expect(canAfford(makeState(DOUBLE_ALL), UPGRADE)).toBe(false)
  })

  // A pact discount (plan 42) is the same seam in the other direction: the
  // quote drops, and the marker points the other way so a price *below* the
  // tree's number reads as a treaty rather than a bug.
  it('quotes the discounted price, marked down', () => {
    const label = formatUpgradeCost(makeState(undefined, MIRRORED), UPGRADE, flavor)
    expect(label).toContain('75')
    expect(label).toContain(DISCOUNTED_COST_MARKER)
    expect(label).not.toContain(INFLATED_COST_MARKER)
  })

  it('marks an item that is both inflated and discounted as inflated', () => {
    const label = formatUpgradeCost(makeState(DOUBLE_ALL, MIRRORED), UPGRADE, flavor)
    expect(label).toContain('150') // 100 × 2 × 0.75
    expect(label).toContain(INFLATED_COST_MARKER)
  })
})

describe('generator card', () => {
  /** The first generator, its own currency, and its authored prices. */
  const g0 = modeDef.generators[0]
  const costIcon = getResourceIcon(flavor, generatorCostCurrency(g0))
  const basePrice = getGeneratorCost(g0, 0)
  const baseRefund = getGeneratorSellRefund(g0, 1)

  /** The upgrade whose `generatorUnlock` effect gates `g0`. */
  const unlockId = modeDef.upgrades.find((u) =>
    (u.effects ?? []).some((e) => e.type === 'generatorUnlock' && e.generator === g0.id),
  )!.id

  /** The panel's markup for a player owning one `g0` (so buy *and* sell show). */
  function renderWithG0(incoming?: EnemyCostFactor[], discounts?: PactCostFactor[]): string {
    const state = makeState(incoming, discounts)
    state.player.upgrades[unlockId] = 1
    state.player.generators[g0.id] = 1
    // Enough of g0's currency to afford the inflated copy, so the price shows
    // rather than a disabled button.
    state.player.resources[generatorCostCurrency(g0)] = 1e6
    const container = { innerHTML: '' } as HTMLElement
    generatorsPanel.render(container, state)
    return container.innerHTML
  }

  it('quotes the inflated buy price, marked, while refunding the authored one', () => {
    const html = renderWithG0([{ scope: 'generator', costFactor: 2 }])
    expect(html).toContain(`Buy 1 — ${costIcon}${formatNumber(basePrice * 2)}`)
    expect(html).toContain(INFLATED_COST_MARKER)
    // The refund is the player's *own* price: an inflated one would let a heavy
    // attack be sold back at a profit.
    expect(html).toContain(`+${costIcon}${formatNumber(baseRefund)}`)
  })

  it('leaves both figures authored when nobody is attacking', () => {
    const html = renderWithG0()
    expect(html).toContain(`Buy 1 — ${costIcon}${formatNumber(basePrice)}`)
    expect(html).not.toContain(INFLATED_COST_MARKER)
    expect(html).not.toContain(DISCOUNTED_COST_MARKER)
    expect(html).toContain(`+${costIcon}${formatNumber(baseRefund)}`)
  })

  it('quotes a pact-discounted buy price, marked down, while refunding the authored one', () => {
    const html = renderWithG0(undefined, MIRRORED)
    expect(html).toContain(`Buy 1 — ${costIcon}${formatNumber(basePrice * 0.5)}`)
    expect(html).toContain(DISCOUNTED_COST_MARKER)
    expect(html).not.toContain(INFLATED_COST_MARKER)
    expect(html).toContain(`+${costIcon}${formatNumber(baseRefund)}`)
  })
})

describe('enemy-data panel — standing inflation warning', () => {
  function render(state: GameState): string {
    const container = { innerHTML: '' } as HTMLElement
    espionagePanel.render(container, state)
    return container.innerHTML
  }

  it('warns while an inflation is present, with no espionage researched', () => {
    const html = render(makeState([{ scope: 'upgrade', costFactor: 1.25 }]))
    expect(html).toContain('espionage-warning')
    expect(html).toContain('upgrades cost 25% more')
    // Ungated: the rest of the panel is still the locked teaser.
    expect(html).toContain('No intel yet')
  })

  it('names a single-entity target by its flavor name', () => {
    const html = render(makeState([{ scope: 'generator', id: 'g0', costFactor: 2 }]))
    expect(html).toContain('100% more')
    expect(html).toContain(flavor.generators[0].name)
  })

  // The two knobs compound differently over a run, so they get one line each
  // rather than a single summed percentage.
  it('reports base-price and growth inflation separately', () => {
    const html = render(makeState([{ scope: 'upgrade', costFactor: 1.5, scalingFactor: 1.2 }]))
    expect(html).toContain('cost 50% more')
    expect(html).toContain('price growth is 20% steeper')
  })

  it('stays silent when no attack is in force', () => {
    expect(render(makeState())).not.toContain('espionage-warning')
  })
})
