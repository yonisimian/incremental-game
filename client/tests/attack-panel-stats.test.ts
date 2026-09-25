/**
 * The attack panel's derived stat line and params-aware cost row.
 *
 * Node tier, not DOM: the panel renders by assigning one `innerHTML` string, so
 * a stub container is enough to fail truthfully — a happy-dom mount would only
 * re-test string rendering (see testing.instructions.md).
 *
 * The idler tree deliberately authors no `attackStat` node yet, so this file
 * re-registers `idler` with a few synthetic stat upgrades bolted on. Vitest
 * isolates test files, so the augmented registration cannot leak into any other
 * suite.
 */

import { describe, expect, it } from 'vitest'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  createInitialState,
  getAttackPrepareCost,
  getModeDefinition,
  NEUTRAL_ATTACK_PARAMS,
  registerMode,
} from '@game/shared'
import type { UpgradeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'
import { attackPanel } from '../src/ui/panels/attack-panel.js'
import { formatNumber } from '../src/ui/format-number.js'

// ─── Mode with synthetic stat upgrades ───────────────────────────────

/** An `attackStat` upgrade over a0 (unless `params` names another), buyable up to three times. */
function statUpgrade(id: string, params: Record<string, unknown>): UpgradeDefinition {
  return {
    id,
    cost: { r0: { baseCost: 0 } },
    purchaseLimit: 3,
    effects: [{ type: 'attackStat', attack: 'a0', ...params }],
  }
}

const POWER_UP = statUpgrade('t-power', { stat: 'power', op: 'mult', value: 2 })
const CHEAPER = statUpgrade('t-cheap', { stat: 'prepareCost', op: 'mult', value: 0.5 })
const FASTER = statUpgrade('t-fast', { stat: 'prepareTime', op: 'mult', value: 0.5 })
/** The absolute op: one literal second off the delay, per level. */
const SOONER = statUpgrade('t-sooner', { stat: 'prepareTime', op: 'offset', value: -1 })

const base = getModeDefinition('idler')
/** A power buff aimed at the tree's first passive attack. */
const PASSIVE_POWER = statUpgrade('t-passive-power', {
  attack: base.attacks.find((a) => a.kind === 'passive')!.id,
  stat: 'power',
  op: 'mult',
  value: 2,
})

registerMode('idler', {
  ...base,
  upgrades: [...base.upgrades, POWER_UP, CHEAPER, FASTER, SOONER, PASSIVE_POWER],
})
const modeDef = getModeDefinition('idler')

const panelUpgrade = modeDef.upgrades.find((u) =>
  u.effects?.some((e) => e.type === 'panelUnlock' && (e as { panel?: string }).panel === 'attack'),
)!
const a0Upgrade = modeDef.upgrades.find((u) =>
  u.effects?.some((e) => e.type === 'unlockAttack' && (e as { attack?: string }).attack === 'a0'),
)!

/** The first passive attack the tree declares, and the upgrade that unlocks it. */
const passiveAttack = modeDef.attacks.find((a) => a.kind === 'passive')!
const passiveUpgrade = modeDef.upgrades.find((u) =>
  u.effects?.some(
    (e) => e.type === 'unlockAttack' && (e as { attack?: string }).attack === passiveAttack.id,
  ),
)!

const a0 = modeDef.attacks.find((a) => a.id === 'a0')!

/** a0's authored Wood prepare cost, read from the tree rather than pinned here. */
const a0Cost = getAttackPrepareCost(a0, NEUTRAL_ATTACK_PARAMS).r0

/** a0's authored strike delay, and the card's spelling of a resolved one. */
const a0Delay = a0.prepareTimeSec!
const prepLabel = (seconds: number): string => `Prep ${String(Math.round(seconds * 10) / 10)}s`

/** A playing state with the attack panel + a0 unlocked, `wood` held, `stats` owned. */
function makeState(wood: number, stats: Record<string, number> = {}): GameState {
  const player = createInitialState(modeDef)
  player.resources.r0 = wood
  player.upgrades[panelUpgrade.id] = 1
  player.upgrades[a0Upgrade.id] = 1
  Object.assign(player.upgrades, stats)
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
    upgrades: modeDef.upgrades,
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

function renderHtml(state: GameState): string {
  const container = { innerHTML: '' } as HTMLElement
  attackPanel.render(container, state)
  return container.innerHTML
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('attackPanel — attackStat reporting', () => {
  it('shows no derived line while no stat upgrade is owned', () => {
    const html = renderHtml(makeState(a0Cost))
    expect(html).toContain('data-attack="a0"')
    expect(html).not.toContain('attack-stats')
    expect(html).not.toContain('Power ×')
  })

  it('reports a power buff as its own line, compounded by owned count', () => {
    expect(renderHtml(makeState(a0Cost, { 't-power': 1 }))).toContain('Power ×2')
    expect(renderHtml(makeState(a0Cost, { 't-power': 3 }))).toContain('Power ×8')
  })

  it('reports the delay as resolved seconds, and never a cost factor (the cost row has it)', () => {
    const html = renderHtml(makeState(a0Cost, { 't-fast': 1, 't-cheap': 1 }))
    expect(html).toContain(prepLabel(a0Delay / 2))
    expect(html).not.toContain('Power ×')
    expect(html).not.toContain('Cost ×')
  })

  it('reports an offset in the seconds it removes, not as a factor', () => {
    // The whole point of the absolute op: one level is one second, and the card
    // says so — a multiplier could not express it.
    expect(renderHtml(makeState(a0Cost, { 't-sooner': 1 }))).toContain(prepLabel(a0Delay - 1))
    expect(renderHtml(makeState(a0Cost, { 't-sooner': 2 }))).toContain(prepLabel(a0Delay - 2))
    // Scaled first, then shifted — the same order the server stamps.
    expect(renderHtml(makeState(a0Cost, { 't-fast': 1, 't-sooner': 1 }))).toContain(
      prepLabel(a0Delay / 2 - 1),
    )
  })

  it('quotes the discounted price in the cost row', () => {
    const full = renderHtml(makeState(a0Cost * 4))
    const halved = renderHtml(makeState(a0Cost * 4, { 't-cheap': 1 }))
    expect(full).toContain(`>${formatNumber(a0Cost)} `)
    expect(halved).toContain(`>${formatNumber(a0Cost / 2)} `)
    expect(halved).not.toContain(`>${formatNumber(a0Cost)} `)
  })

  it('reports power on a passive card', () => {
    const state = makeState(a0Cost, {
      [passiveUpgrade.id]: 1,
      't-passive-power': 1,
    })
    const html = renderHtml(state)
    const passiveCard = html.slice(html.indexOf('Passive'))
    expect(passiveCard).toContain('Power ×2')
    expect(passiveCard).not.toContain('Prep ')
  })

  it('enables the button at a price only the discount makes affordable', () => {
    // Half the authored cost held: blocked at the authored price, armed at the
    // discounted one — the panel and `attackBlockReason` agreeing on one figure.
    const broke = renderHtml(makeState(a0Cost / 2))
    expect(broke).toContain('Not enough resources')
    expect(broke).toContain('disabled')

    const discounted = renderHtml(makeState(a0Cost / 2, { 't-cheap': 1 }))
    expect(discounted).not.toContain('Not enough resources')
    expect(discounted).toContain('attack-cost')
  })
})

// ─── Debuff windows (plan 37) ────────────────────────────────────────

describe('attackPanel — debuff window status', () => {
  /** `makeState`, at `gameSec`, with a0's window open until `expiresAtSec`. */
  function windowState(gameSec: number, expiresAtSec: number): GameState {
    const state = makeState(a0Cost * 4)
    state.player.meta.gameSec = gameSec
    state.player.activeDebuffs = [{ attack: 'a0', expiresAtSec }]
    return state
  }

  /** The a0 card alone, so a passive card's markup can't satisfy an assertion. */
  const a0Card = (html: string): string => {
    const start = html.indexOf('data-attack="a0"')
    const end = html.indexOf('</li>', start)
    return html.slice(start, end)
  }

  it('shows the remaining window and disables the button while it is open', () => {
    const card = a0Card(renderHtml(windowState(10, 17.4)))
    expect(card).toContain('Active for 7.4s')
    expect(card).toContain('attack-status--active')
    expect(card).toContain('attack-btn active')
    expect(card).toContain('disabled')
    // The window replaces the price, as the preparing countdown does.
    expect(card).not.toContain('attack-cost')
    expect(card).not.toContain('Not enough resources')
  })

  it('goes back to quoting the price once the window has closed', () => {
    const card = a0Card(renderHtml(windowState(17.4, 17.4)))
    expect(card).not.toContain('Active for')
    expect(card).not.toContain('disabled')
    expect(card).toContain('attack-cost')
  })

  it('lets the preparing countdown win over an open window from the same attack', () => {
    // Can't happen in play (an open window blocks activation), but the order
    // is part of the contract: a pending strike is the more urgent state.
    const state = windowState(10, 17.4)
    state.player.pendingAttacks.push({ attack: 'a0', readyAtSec: 12 })
    const card = a0Card(renderHtml(state))
    expect(card).toContain('Striking in 2.0s')
    expect(card).not.toContain('Active for')
  })

  it('reports a stretched window as resolved seconds on the stat line', () => {
    // a0 is a steal with no window, so the line stays off until the attack
    // authors one — patch a duration in and hand the player a duration stat.
    const patched = {
      ...modeDef,
      attacks: modeDef.attacks.map((a) =>
        a.id === 'a0'
          ? {
              ...a,
              durationSec: 10,
              effects: [
                ...(a.effects ?? []),
                {
                  type: 'enemyProductionModifier',
                  stage: 'multiplicative',
                  field: 'r0',
                  value: 0.5,
                },
              ],
            }
          : a,
      ),
      upgrades: [
        ...modeDef.upgrades,
        statUpgrade('t-longer', { stat: 'duration', op: 'mult', value: 1.5 }),
      ],
    }
    registerMode('idler', patched)
    try {
      expect(renderHtml(makeState(a0Cost))).not.toContain('Lasts ')
      expect(renderHtml(makeState(a0Cost, { 't-longer': 1 }))).toContain('Lasts 15s')
      expect(renderHtml(makeState(a0Cost, { 't-longer': 2 }))).toContain('Lasts 22.5s')
    } finally {
      registerMode('idler', modeDef)
    }
  })
})
