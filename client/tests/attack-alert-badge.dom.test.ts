// @vitest-environment happy-dom
//
// Plan 41 — the header's attack-alert badge: hidden with nothing inbound, the
// soonest strike with a `+N` for the rest, named only when revealed, a
// countdown that interpolates between snapshots and never goes negative, and
// a pulse under two seconds. DOM tier because `hidden`, the class toggle and
// the text nodes are what the player actually sees.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, getModeDefinition, getModeFlavor } from '@game/shared'
import type { IncomingAttack } from '@game/shared'
import type { GameState } from '../src/game.js'
import {
  attackAlertView,
  formatAlertRemaining,
  renderAttackAlertBadge,
  resetAttackAlertBadge,
  updateAttackAlertBadge,
} from '../src/ui/attack-alert.js'
import { resetDom } from './dom-harness.js'

const mode = getModeDefinition('idler')
const flavor = getModeFlavor(mode)

function makeState(
  incomingAttacks: IncomingAttack[],
  gameSec = 20,
  extra: Partial<GameState> = {},
): GameState {
  const player = createInitialState(mode)
  player.meta.gameSec = gameSec
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: 60 },
    player,
    opponent: { resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    debuffs: [],
    pactBonuses: [],
    opponentPacts: [],
    incomingAttacks,
    timeLeft: 60,
    paused: false,
    vsBot: false,
    matchId: null,
    upgrades: [],
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
    ...extra,
  }
}

describe('attackAlertView', () => {
  it('is null with nothing inbound', () => {
    expect(attackAlertView(makeState([]), flavor, 20)).toBeNull()
  })

  it('picks the soonest strike and counts the others', () => {
    const view = attackAlertView(
      makeState([{ readyAtSec: 30 }, { readyAtSec: 24 }, { readyAtSec: 27 }]),
      flavor,
      20,
    )
    expect(view).toEqual({ label: 'Incoming attack', remainingSec: 4, others: 2 })
  })

  it('names a revealed strike from the flavor and floors the countdown at zero', () => {
    const view = attackAlertView(makeState([{ readyAtSec: 19, attack: 'a0' }]), flavor, 20)
    expect(view?.label).toContain('Steal')
    expect(view?.remainingSec).toBe(0)
  })

  it('formats tenths while counting and "now!" once due', () => {
    expect(formatAlertRemaining(4)).toBe('4.0s')
    expect(formatAlertRemaining(0.26)).toBe('0.3s')
    expect(formatAlertRemaining(0)).toBe('now!')
  })
})

describe('header badge', () => {
  let now = 1000

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    // Drive frames by hand: the loop is asserted through what it paints.
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    document.body.innerHTML = `<header>${renderAttackAlertBadge()}</header>`
    resetAttackAlertBadge()
  })

  afterEach(() => {
    resetAttackAlertBadge()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetDom()
  })

  const badge = () => document.getElementById('attack-alert')!
  const text = (id: string) => document.getElementById(id)!.textContent

  it('starts hidden and stays hidden with nothing inbound', () => {
    expect(badge().hidden).toBe(true)
    updateAttackAlertBadge(makeState([]), flavor)
    expect(badge().hidden).toBe(true)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('shows the soonest strike with a +N for the rest, and starts its loop', () => {
    updateAttackAlertBadge(makeState([{ readyAtSec: 24.5 }, { readyAtSec: 40 }]), flavor)
    expect(badge().hidden).toBe(false)
    expect(text('attack-alert-name')).toBe('Incoming attack +1')
    expect(text('attack-alert-time')).toBe('4.5s')
    expect(badge().classList.contains('attack-alert--imminent')).toBe(false)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('interpolates between snapshots and re-anchors on a fresh one', () => {
    updateAttackAlertBadge(makeState([{ readyAtSec: 24 }]), flavor)
    expect(text('attack-alert-time')).toBe('4.0s')

    // 300ms of wall clock with no new snapshot: the same state, notified again
    // (a local click), reads the interpolated value.
    now += 300
    updateAttackAlertBadge(makeState([{ readyAtSec: 24 }]), flavor)
    expect(text('attack-alert-time')).toBe('3.7s')

    // A fresh snapshot re-anchors: the server says 20.5, so 3.5s, not 3.4s.
    now += 300
    updateAttackAlertBadge(makeState([{ readyAtSec: 24 }], 20.5), flavor)
    expect(text('attack-alert-time')).toBe('3.5s')
  })

  it('freezes while paused', () => {
    updateAttackAlertBadge(makeState([{ readyAtSec: 24 }]), flavor)
    now += 900
    updateAttackAlertBadge(makeState([{ readyAtSec: 24 }], 20, { paused: true }), flavor)
    expect(text('attack-alert-time')).toBe('4.0s')
  })

  it('pulses under two seconds, reads "now!" at zero, and never goes negative', () => {
    updateAttackAlertBadge(makeState([{ readyAtSec: 21.5, attack: 'a0' }]), flavor)
    expect(badge().classList.contains('attack-alert--imminent')).toBe(true)
    expect(text('attack-alert-name')).toContain('Steal')
    now += 2000
    updateAttackAlertBadge(makeState([{ readyAtSec: 21.5, attack: 'a0' }]), flavor)
    expect(text('attack-alert-time')).toBe('now!')
  })

  it('hides again once the list empties', () => {
    updateAttackAlertBadge(makeState([{ readyAtSec: 24 }]), flavor)
    expect(badge().hidden).toBe(false)
    updateAttackAlertBadge(makeState([], 24.5), flavor)
    expect(badge().hidden).toBe(true)
  })
})
