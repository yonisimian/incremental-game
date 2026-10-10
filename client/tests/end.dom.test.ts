// @vitest-environment happy-dom
//
// The end screen's headline depends on both `reason` and `winner` (a quit
// reads differently to the resigner than to the opponent), and the duration
// readout must tolerate an older server that doesn't send it yet. DOM tier
// because these are about the rendered markup, not game logic.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ROUND_DURATION_SEC } from '@game/shared'
import type { RoundEndMessage } from '@game/shared'
import type { GameState } from '../src/game.js'

vi.mock('../src/game.js', () => ({ rematch: vi.fn(), resetForMatch: vi.fn() }))
vi.mock('../src/ui/report-modal.js', () => ({ openReportModal: vi.fn() }))

let renderEndScreen: (typeof import('../src/ui/end.js'))['renderEndScreen']

beforeAll(async () => {
  // `ui/helpers.ts` resolves `#app` at import time, so it must exist first.
  document.body.innerHTML = '<div id="app"></div>'
  ;({ renderEndScreen } = await import('../src/ui/end.js'))
})

function endState(end: Partial<RoundEndMessage>): GameState {
  const endData: RoundEndMessage = {
    type: 'ROUND_END',
    winner: 'player',
    reason: 'complete',
    finalScores: { player: 120, opponent: 80 },
    durationSec: ROUND_DURATION_SEC,
    stats: { totalClicks: 0, peakCps: 0, upgradesPurchased: [] },
    ...end,
  }
  return {
    mode: 'idler',
    goal: { type: 'timed', durationSec: ROUND_DURATION_SEC },
    playerName: 'Me',
    opponentName: 'Them',
    endData,
  } as unknown as GameState
}

const result = (): string => document.querySelector('.result')!.textContent
const duration = (): HTMLElement | null => document.querySelector('.end-duration-value')

describe('end screen (DOM)', () => {
  it('tells the resigner they resigned, without a win/loss class', () => {
    renderEndScreen(endState({ reason: 'quit', winner: 'opponent' }))
    expect(result()).toBe('You Resigned')
    expect(document.querySelector('.result')!.classList.contains('opponent')).toBe(true)
  })

  it('tells the other player the opponent resigned', () => {
    renderEndScreen(endState({ reason: 'quit', winner: 'player' }))
    expect(result()).toBe('Opponent Resigned')
  })

  it('shows the match duration as m:ss', () => {
    renderEndScreen(endState({ durationSec: 95 }))
    expect(duration()!.textContent).toBe('1:35')
  })

  it('omits the duration block when the server did not send one', () => {
    renderEndScreen(endState({ durationSec: undefined }))
    expect(duration()).toBeNull()
    expect(document.body.textContent).not.toContain('NaN')
  })
})
