import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/game.js'
import { getModeUI } from '../src/ui/mode-ui.js'

/** Minimal GameState carrying only the player upgrades an unlock gate reads. */
function playerWith(upgrades: Record<string, number>): GameState {
  return { player: { upgrades } } as unknown as GameState
}

describe('getModeUI', () => {
  it('surfaces the play, upgrades, and generators panels for idler', () => {
    const ui = getModeUI('idler')
    expect(ui.panels.map((p) => p.panel.id)).toEqual(['play', 'upgrades', 'generators'])
  })

  it('gates the generators panel on its panelUnlock effect', () => {
    // Exercises the Panel.id ↔ panelUnlock effect coupling end-to-end: a mismatch
    // would leave the gate open and these assertions would fail.
    const generators = getModeUI('idler').panels.find((p) => p.panel.id === 'generators')
    expect(generators?.isUnlocked?.(playerWith({}))).toBe(false)
    expect(generators?.isUnlocked?.(playerWith({ 'g1-g2': 1 }))).toBe(true)
  })
})
