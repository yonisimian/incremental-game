// @vitest-environment happy-dom
//
// The two surfaces that report an incoming highlight-factor debuff to its victim.
// They deliberately differ in when they show, so each is pinned here:
//
//  - the enemy-data (espionage) panel warns *whenever the debuff is present*,
//    including while the highlight is released and before any espionage is
//    researched — it's something being done to the player, not intel;
//  - the data panel's Highlight section reports it *only while a resource is
//    held*, where it explains the multiplier sitting directly above it.
//
// DOM tier because both read real elements: the data panel toggles `hidden` on a
// live row, which no-ops in the plain node environment.

import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialState, getModeDefinition } from '@game/shared'
import type { Modifier } from '@game/shared'
import type { GameState } from '../src/game.js'
import { dataPanel } from '../src/ui/panels/data-panel.js'
import { espionagePanel } from '../src/ui/panels/espionage-panel.js'

const modeDef = getModeDefinition('idler')

const HL_DEBUFF: Modifier = { stage: 'multiplicative', field: 'highlightFactor', value: 0.9 }
const RATE_DEBUFF: Modifier = { stage: 'multiplicative', field: 'r0', value: 0.5 }

/** A playing-screen state holding `highlight`, with the given incoming debuffs. */
function makeState(highlight: string | null, debuffs: Modifier[]): GameState {
  const player = createInitialState(modeDef)
  player.meta.highlight = highlight
  // sh-unlock carries `highlightMultiplier ×2`, so the section reports a real
  // multiplier the debuff can visibly bite into rather than a bare ×1.
  player.upgrades['sh-unlock'] = 1
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: 60 },
    player,
    opponent: { resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    debuffs,
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

function renderData(state: GameState): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  dataPanel.render(container, state)
  return container
}

function renderEspionage(state: GameState): string {
  const container = document.createElement('div')
  document.body.append(container)
  espionagePanel.render(container, state)
  return container.innerHTML
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('enemy-data panel — standing debuff warning', () => {
  it('warns while the debuff is present, with no espionage researched', () => {
    // The player owns no `accessEnemyData` upgrade, so the rest of the panel is
    // its locked teaser — the warning still shows alongside it.
    const html = renderEspionage(makeState('r0', [HL_DEBUFF]))
    expect(html).toContain('espionage-warning')
    expect(html).toContain('10%')
    expect(html).toContain('No intel yet')
  })

  it('states a compounded reduction to a tenth of a percent', () => {
    // ×0.9 × ×0.95 = ×0.855 → 14.5% off, and the float noise in (1 - 0.855) must
    // not surface as "14%" or a long tail.
    const html = renderEspionage(
      makeState('r0', [
        HL_DEBUFF,
        { stage: 'multiplicative', field: 'highlightFactor', value: 0.95 },
      ]),
    )
    expect(html).toContain('14.5%')
  })

  it('keeps warning while the highlight is released', () => {
    // Releasing dodges the debuff, which is exactly when the player most needs
    // to be told holding is worth less than the tree claims.
    expect(renderEspionage(makeState(null, [HL_DEBUFF]))).toContain('espionage-warning')
  })

  it('stays silent with no debuff, and for a debuff that is not on the highlight', () => {
    expect(renderEspionage(makeState('r0', []))).not.toContain('espionage-warning')
    expect(renderEspionage(makeState('r0', [RATE_DEBUFF]))).not.toContain('espionage-warning')
  })
})

describe('data panel — Highlight section', () => {
  function row(container: HTMLElement): HTMLElement {
    const el = container.querySelector<HTMLElement>('#data-hl-debuff-row')
    expect(el).not.toBeNull()
    return el!
  }

  function text(container: HTMLElement, id: string): string {
    return container.querySelector(`#${id}`)?.textContent ?? ''
  }

  it('shows the debuff row and a debuffed multiplier while a resource is held', () => {
    const container = renderData(makeState('r0', [HL_DEBUFF]))
    expect(row(container).hidden).toBe(false)
    expect(text(container, 'data-hl-debuff')).toBe('×0.9')
    // sh-unlock's ×2 bonus, cut 10% → F' = 1 + (2−1)·0.9 = ×1.9 (bonus-scaled,
    // not the whole factor ×1.8), matching the production it buys.
    expect(text(container, 'data-hl-mult')).toBe('×1.9')
  })

  it('hides the row while the highlight is released', () => {
    const container = renderData(makeState(null, [HL_DEBUFF]))
    expect(row(container).hidden).toBe(true)
    // Released, the factor lands nowhere — so neither does the debuff.
    expect(text(container, 'data-hl-mult')).toBe('×1')
  })

  it('hides the row when no highlight debuff is incoming', () => {
    const container = renderData(makeState('r0', [RATE_DEBUFF]))
    expect(row(container).hidden).toBe(true)
    expect(text(container, 'data-hl-mult')).toBe('×2')
  })
})
