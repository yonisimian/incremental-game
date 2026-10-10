// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { COUNTDOWN_SEC, getModeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'
import {
  TIME_LEFT_ATTR,
  countdownSpan,
  counterAttr,
  paintCounters,
  syncCounters,
} from '../src/ui/counters.js'

/** A paused snapshot, so nothing advances between sync and paint. */
function makeState(): GameState {
  return {
    screen: 'playing',
    mode: 'idler',
    goal: null,
    player: {
      score: 42,
      resources: { r0: 5, r1: 7 },
      upgrades: {},
      generators: {},
      pendingAttacks: [],
      meta: { gameSec: 10 },
    },
    opponent: { score: 9, resources: { r0: 3 }, rates: {} },
    opponentPurchaseFeed: [],
    incomingAttacks: [],
    pactBonuses: [],
    opponentPacts: [],
    opponentPactWindows: [],
    incomingAutoClicksPerSec: 0,
    debuffs: [],
    timeLeft: 30,
    paused: true,
    resigning: false,
    vsBot: false,
    matchId: 'counters-dom',
    upgrades: [],
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

afterEach(() => {
  document.body.innerHTML = ''
})

describe('paintCounters', () => {
  it('fills every element that opted in through the markup helpers', () => {
    document.body.innerHTML = `
      <span id="own-r1"${counterAttr('own', 'r1')}>?</span>
      <span id="own-score"${counterAttr('own')}>?</span>
      <span id="their-r0"${counterAttr('theirs', 'r0')}>?</span>
      <span id="their-score"${counterAttr('theirs')}>?</span>
      <span id="timer"${TIME_LEFT_ATTR}>?</span>
      <p id="countdown">${countdownSpan({ template: 'lands in {}s', untilSec: 14 }, 0)}</p>
    `
    syncCounters(makeState(), getModeDefinition('idler'), {})
    paintCounters()

    const text = (id: string) => document.getElementById(id)?.textContent
    expect(text('own-r1')).toBe('7')
    expect(text('own-score')).toBe('42')
    expect(text('their-r0')).toBe('3')
    expect(text('their-score')).toBe('9')
    expect(text('timer')).toBe('0:30')
    expect(text('countdown')).toBe('lands in 4.0s')
  })

  it('leaves a counter it does not track yet alone', () => {
    document.body.innerHTML = `<span id="unknown"${counterAttr('theirs', 'r1')}>kept</span>`
    syncCounters(makeState(), getModeDefinition('idler'), {})
    paintCounters()
    expect(document.getElementById('unknown')?.textContent).toBe('kept')
  })
})
