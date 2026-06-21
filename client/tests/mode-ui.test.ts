import { afterEach, describe, expect, it } from 'vitest'
import { getModeDefinition, registerMode } from '@game/shared'
import type { UpgradeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'
import { getModeUI } from '../src/ui/mode-ui.js'

/** Minimal GameState carrying only the player upgrades an unlock gate reads. */
function playerWith(upgrades: Record<string, number>): GameState {
  return { player: { upgrades } } as unknown as GameState
}

describe('getModeUI', () => {
  it('surfaces the base panels plus every panel the idler tree unlocks, in order', () => {
    // The live idler tree gates attack / international-relationship / espionage
    // via panelUnlock upgrades, so they follow the always-on base panels.
    const ui = getModeUI('idler')
    expect(ui.panels.map((p) => p.panel.id)).toEqual([
      'play',
      'upgrades',
      'generators',
      'attack',
      'international-relationship',
      'espionage',
    ])
  })

  it('gates the generators panel on its panelUnlock effect', () => {
    // Exercises the Panel.id ↔ panelUnlock effect coupling end-to-end: a mismatch
    // would leave the gate open and these assertions would fail.
    const generators = getModeUI('idler').panels.find((p) => p.panel.id === 'generators')
    expect(generators?.isUnlocked?.(playerWith({}))).toBe(false)
    expect(generators?.isUnlocked?.(playerWith({ 'g1-g2': 1 }))).toBe(true)
  })
})

describe('getModeUI unlockable panels', () => {
  const original = getModeDefinition('idler')
  const NEW_PANELS = ['attack', 'international-relationship', 'espionage']

  /** Does this upgrade carry a panelUnlock effect for one of the new panels? */
  function gatesNewPanel(u: UpgradeDefinition): boolean {
    return (u.effects ?? []).some((e) => {
      const ref = e as { type: string; panel?: string }
      return ref.type === 'panelUnlock' && NEW_PANELS.includes(ref.panel ?? '')
    })
  }

  // Baseline = the idler tree with the new panels' gating upgrades stripped, so
  // we control exactly which of them are gated in each test.
  const baselineUpgrades = original.upgrades.filter((u) => !gatesNewPanel(u))

  /** Register an idler variant gating only the named panels (panel → upgradeId). */
  function registerGating(gates: Record<string, string> = {}): void {
    const unlockUpgrades: UpgradeDefinition[] = Object.entries(gates).map(([panel, upgradeId]) => ({
      id: upgradeId,
      cost: {},
      purchaseLimit: 1,
      modifiers: [],
      effects: [{ type: 'panelUnlock', panel }],
    }))
    registerMode('idler', { ...original, upgrades: [...baselineUpgrades, ...unlockUpgrades] })
  }

  afterEach(() => {
    registerMode('idler', original) // restore the pristine tree
  })

  it('omits an unlockable panel until an upgrade gates it', () => {
    registerGating() // no gates for the new panels
    const ids = getModeUI('idler').panels.map((p) => p.panel.id)
    expect(ids).not.toContain('attack')
    expect(ids).not.toContain('espionage')
    expect(ids).not.toContain('international-relationship')
  })

  it('surfaces gated panels in declared order, after the base panels', () => {
    // Gate attack and espionage (skip international-relationship) — they must appear
    // in their declared order (attack before espionage), not gate-discovery order.
    registerGating({ espionage: 'unlock-espionage', attack: 'unlock-attack' })
    const ids = getModeUI('idler').panels.map((p) => p.panel.id)
    expect(ids).toEqual(['play', 'upgrades', 'generators', 'attack', 'espionage'])
  })

  it('locks a gated panel until its unlock upgrade is owned', () => {
    registerGating({ attack: 'unlock-attack' })
    const attack = getModeUI('idler').panels.find((p) => p.panel.id === 'attack')
    expect(attack?.isUnlocked?.(playerWith({}))).toBe(false)
    expect(attack?.isUnlocked?.(playerWith({ 'unlock-attack': 1 }))).toBe(true)
  })
})
