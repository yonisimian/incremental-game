import { describe, expect, it } from 'vitest'
import { getModeDefinition, getModeFlavor } from '@game/shared'
import {
  renderGeneratorCardView,
  type GeneratorCardNums,
} from '../src/ui/panels/generators-panel.js'

const modeDef = getModeDefinition('idler')
const flavor = getModeFlavor(modeDef)
const def = modeDef.generators[0]

function card(overrides: Partial<GeneratorCardNums>): string {
  return renderGeneratorCardView(def, flavor, {
    owned: 0,
    nextCost: 10,
    affordable: false,
    maxAffordable: 0,
    bulkCost: 0,
    sellRefund: 0,
    canSell: false,
    ...overrides,
  })
}

describe('renderGeneratorCardView — dimming', () => {
  it('dims only when the card is fully inert (cannot buy and cannot sell)', () => {
    expect(card({ affordable: false, canSell: false })).toContain('generator-card too-expensive')
  })

  it('does not dim a sellable card even when a re-buy is unaffordable', () => {
    expect(card({ affordable: false, canSell: true })).not.toContain('too-expensive')
  })

  it('does not dim an affordable card', () => {
    expect(card({ affordable: true, canSell: false })).not.toContain('too-expensive')
  })
})
