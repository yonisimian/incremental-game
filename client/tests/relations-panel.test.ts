// Plan 42 — the relations panel shows what each pact is worth: a card per
// unlocked pact with its resolved "worth now" lines and discount line, a
// mutual badge, and the opponent's shared treaties. Node tier: `render` writes
// a string into `innerHTML`, so every assertion is on markup.

import { afterEach, describe, expect, it } from 'vitest'
import {
  createInitialState,
  getModeDefinition,
  getModeFlavor,
  getPactName,
  registerMode,
  validateModeDefinition,
} from '@game/shared'
import type { ModeDefinition, PactBonus, PactCostFactor } from '@game/shared'
import type { GameState } from '../src/game.js'
import { internationalRelationshipPanel } from '../src/ui/panels/international-relationship-panel.js'

const base = getModeDefinition('idler')
const flavor = getModeFlavor(base)

/**
 * The idler with its two passive placeholders given behavior: `p2` a
 * shared-research discount, `p3` a mutual trade route. Patched here so the
 * panel is testable before (and independent of) the tree's own authoring.
 */
function withPactBehavior(): ModeDefinition {
  const patched: ModeDefinition = {
    ...base,
    pacts: base.pacts.map((p) =>
      p.id === 'p2'
        ? { ...p, effects: [{ type: 'mirrorCostModifier', target: 'upgrades', costFactor: 0.75 }] }
        : p.id === 'p3'
          ? {
              ...p,
              mutual: true,
              effects: [
                {
                  type: 'mirrorStatModifier',
                  source: 'generator:g0',
                  field: 'r0',
                  stage: 'multiplicative',
                  perUnit: 0.02,
                  cap: 0.5,
                },
              ],
            }
          : p,
    ),
  }
  validateModeDefinition('idler', patched)
  return patched
}

/** The upgrade whose `unlockPact` effect signs `pactId`. */
function signer(pactId: string): string {
  return base.upgrades.find((u) =>
    u.effects?.some((e) => e.type === 'unlockPact' && (e as { pact?: string }).pact === pactId),
  )!.id
}

function makeState(opts: {
  signed?: string[]
  bonuses?: PactBonus[]
  discounts?: PactCostFactor[]
  shared?: string[]
}): GameState {
  const player = createInitialState(base)
  for (const id of opts.signed ?? []) player.upgrades[signer(id)] = 1
  if (opts.discounts) player.pactCostFactors = opts.discounts
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: 60 },
    player,
    opponent: { resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    incomingAttacks: [],
    debuffs: [],
    pactBonuses: opts.bonuses ?? [],
    opponentPacts: opts.shared ?? [],
    timeLeft: 60,
    paused: false,
    vsBot: false,
    matchId: null,
    upgrades: base.upgrades,
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

function render(state: GameState): string {
  const container = { innerHTML: '' } as HTMLElement
  internationalRelationshipPanel.render(container, state)
  return container.innerHTML
}

const ROUTE_WORTH: PactBonus = {
  pact: 'p3',
  modifiers: [{ stage: 'multiplicative', field: 'r0', value: 1.12 }],
}

describe('relations panel', () => {
  afterEach(() => {
    registerMode('idler', base)
  })

  it('shows the locked placeholder with nothing signed and nothing shared', () => {
    const html = render(makeState({}))
    expect(html).toContain('No pacts unlocked yet')
    expect(html).not.toContain('pact-item')
  })

  it('renders a card per unlocked passive pact and keeps active pacts as disabled buttons', () => {
    registerMode('idler', withPactBehavior())
    const html = render(makeState({ signed: ['p0', 'p2', 'p3'] }))
    expect(html.match(/class="pact-item/g)).toHaveLength(3)
    expect(html).toContain(getPactName(flavor, 'p2'))
    expect(html).toContain(getPactName(flavor, 'p3'))
    // The active placeholder is still a no-op button.
    expect(html).toContain('class="pact-btn" type="button" disabled')
    // No hint line: the pacts do something now.
    expect(html).not.toContain("don't do anything yet")
  })

  it('lists what a pact is worth from the resolved bonuses', () => {
    registerMode('idler', withPactBehavior())
    const html = render(makeState({ signed: ['p3'], bonuses: [ROUTE_WORTH] }))
    expect(html).toContain('+12% 🪵 production')
    expect(html).not.toContain('no bonus yet')
  })

  it('says "no bonus yet" for a pact with effects that resolve to nothing', () => {
    registerMode('idler', withPactBehavior())
    const html = render(makeState({ signed: ['p3'] }))
    expect(html).toContain('no bonus yet')
  })

  it('counts the discount line from the stamped factors tagged with the pact', () => {
    registerMode('idler', withPactBehavior())
    const discounts: PactCostFactor[] = [
      { pact: 'p2', scope: 'upgrade', id: 'be-af-mr', costFactor: 0.75 },
      { pact: 'p2', scope: 'upgrade', id: 'sh-unlock', costFactor: 0.75 },
      { pact: 'p2', scope: 'upgrade', id: 'sc-unlock', costFactor: 0.75 },
    ]
    const html = render(makeState({ signed: ['p2'], discounts }))
    expect(html).toContain('−25% on 3 upgrades the enemy already owns')
    expect(html).not.toContain('no bonus yet')
  })

  it('badges a mutual pact', () => {
    registerMode('idler', withPactBehavior())
    const both = render(makeState({ signed: ['p2', 'p3'] }))
    expect(both.match(/pact-mutual/g)).toHaveLength(1)
    const oneSided = render(makeState({ signed: ['p2'] }))
    expect(oneSided).not.toContain('pact-mutual')
  })

  it('lists the opponent’s shared treaties with their worth, and only when there are any', () => {
    registerMode('idler', withPactBehavior())
    const html = render(makeState({ shared: ['p3'], bonuses: [ROUTE_WORTH] }))
    expect(html).toContain('Shared treaties')
    expect(html).toContain(getPactName(flavor, 'p3'))
    expect(html).toContain('+12% 🪵 production')
    expect(html).not.toContain('No pacts unlocked yet')

    expect(render(makeState({ signed: ['p2'] }))).not.toContain('Shared treaties')
    // A treaty both sides signed sits on the player's own card, not twice.
    const both = render(makeState({ signed: ['p3'], shared: ['p3'], bonuses: [ROUTE_WORTH] }))
    expect(both).not.toContain('Shared treaties')
    expect(both.match(/class="pact-item/g)).toHaveLength(1)
  })
})
