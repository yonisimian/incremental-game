// The relations panel shows what each pact is worth: a card per
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
import type { ActivePact, ModeDefinition, PactBonus, PactCostFactor } from '@game/shared'
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
      // The idler authors no active pact, so this one is turned into the placeholder the panel renders.
      p.id === 'highlighted-clicks'
        ? { id: p.id, kind: 'active' }
        : p.id === 'p2'
          ? {
              ...p,
              effects: [{ type: 'mirrorCostModifier', target: 'upgrades', costFactor: 0.75 }],
            }
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
  windows?: ActivePact[]
  autoClicks?: number
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
    opponentPactWindows: opts.windows ?? [],
    incomingAutoClicksPerSec: opts.autoClicks ?? 0,
    timeLeft: 60,
    paused: false,
    resigning: false,
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
    const html = render(makeState({ signed: ['highlighted-clicks', 'p2', 'p3'] }))
    expect(html.match(/class="pact-item/g)).toHaveLength(3)
    expect(html).toContain(getPactName(flavor, 'p2'))
    expect(html).toContain(getPactName(flavor, 'p3'))
    // The active placeholder is still a no-op button.
    expect(html).toContain('class="pact-btn" type="button" disabled')
    // No hint line: the pacts do something now.
    expect(html).not.toContain("don't do anything yet")
  })

  it('shows held / limit on a capped kind’s heading, and nothing on an uncapped one', () => {
    const patched = withPactBehavior()
    registerMode('idler', {
      ...patched,
      effects: [
        ...(patched.effects ?? []).filter((e) => e.type !== 'pactSlots'),
        { type: 'pactSlots', pactKind: 'passive', value: 3 },
      ],
    })
    const html = render(makeState({ signed: ['highlighted-clicks', 'p2', 'p3'] }))
    expect(html).toContain('Passive <span class="pact-slots">2 / 3</span>')
    expect(html).toContain('<h3 class="pact-heading">Active</h3>')
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

  describe('active pacts', () => {
    const DRUMS = 'p-drums'
    const SIGN_DRUMS = 'sign-p-drums'

    /** The idler plus Drum Accord: 300 🪵, clicks ×2 for 15s, 3 clicks/s to the enemy, 45s rest. */
    function withDrums(): ModeDefinition {
      const def: ModeDefinition = {
        ...base,
        pacts: [
          ...base.pacts,
          {
            id: DRUMS,
            kind: 'active',
            activationCost: { r0: { baseCost: 300 } },
            durationSec: 15,
            cooldownSec: 45,
            effects: [
              {
                type: 'pactProductionModifier',
                stage: 'multiplicative',
                field: 'clickIncome',
                value: 2,
              },
              { type: 'partnerAutoClick', clicksPerSec: 3 },
            ],
          },
        ],
        upgrades: [
          ...base.upgrades,
          {
            id: SIGN_DRUMS,
            cost: {},
            purchaseLimit: 1,
            effects: [{ type: 'unlockPact', pact: DRUMS }],
          },
        ],
        flavors: base.flavors.map((f) => ({
          ...f,
          pacts: [...f.pacts, { id: DRUMS, name: 'Drum Accord', icon: '🥁', description: '' }],
          upgrades: [...f.upgrades, { id: SIGN_DRUMS, name: 'Drums', icon: '🥁', description: '' }],
        })),
      }
      validateModeDefinition('idler', def)
      return def
    }

    /** A signer of Drum Accord at game second 10 holding `wood`, with `patch` applied. */
    function signerState(wood: number, patch: Partial<GameState['player']> = {}): GameState {
      const state = makeState({})
      state.player.upgrades[SIGN_DRUMS] = 1
      state.player.resources.r0 = wood
      state.player.meta.gameSec = 10
      Object.assign(state.player, patch)
      return state
    }

    const drumsCard = (html: string): string => {
      const start = html.indexOf(`data-pact="${DRUMS}"`)
      return html.slice(start, html.indexOf('</li>', start))
    }

    it('quotes the price on an enabled button when the pact can be signed', () => {
      registerMode('idler', withDrums())
      const card = drumsCard(render(signerState(1000)))
      expect(card).toContain('300 🪵')
      expect(card).toContain('class="pact-btn" type="button">')
      expect(card).not.toContain('disabled')
    })

    it('shows the shortfall and disables the button when short', () => {
      registerMode('idler', withDrums())
      const card = drumsCard(render(signerState(120)))
      expect(card).toContain('120/300 🪵')
      expect(card).toContain('pact-status--blocked')
      expect(card).toContain('disabled')
    })

    it('counts the open window down with what it is worth, disabled', () => {
      registerMode('idler', withDrums())
      const state = signerState(1000, { activePacts: [{ pact: DRUMS, expiresAtSec: 17.4 }] })
      state.pactBonuses = [
        { pact: DRUMS, modifiers: [{ stage: 'multiplicative', field: 'clickIncome', value: 2 }] },
      ]
      const card = drumsCard(render(state))
      expect(card).toContain('Active for 7.4s')
      expect(card).toContain('+100% per click')
      expect(card).toContain('pact-btn active')
      expect(card).toContain('disabled')
      expect(card).not.toContain('300 🪵')
    })

    it('counts the rest down after the window, disabled however rich', () => {
      registerMode('idler', withDrums())
      const state = signerState(1e9, { cooldowns: [{ kind: 'pact', id: DRUMS, untilSec: 22.5 }] })
      const card = drumsCard(render(state))
      expect(card).toContain('Ready in 12.5s')
      expect(card).toContain('pact-btn cooling')
      expect(card).toContain('disabled')
    })

    it('shows the enemy’s gift window as a shared treaty, with its countdown and rate', () => {
      registerMode('idler', withDrums())
      const window = { pact: DRUMS, expiresAtSec: 17.4 }
      const receiving = makeState({ shared: [DRUMS], windows: [window], autoClicks: 3 })
      receiving.player.meta.gameSec = 10
      const html = render(receiving)
      expect(html).toContain('Shared treaties')
      expect(html).toContain('Active for 7.4s')
      expect(html).toContain('+3 clicks/s for you')

      const cannotClick = makeState({ shared: [DRUMS], windows: [window] })
      cannotClick.player.meta.gameSec = 10
      expect(render(cannotClick)).toContain('unlock clicking to use them')
    })

    it('shows the enemy’s open window on the viewer’s own card when both have signed', () => {
      registerMode('idler', withDrums())
      // Both signed Drum Accord; only the enemy's window is open, gifting 3 clicks/s.
      const state = signerState(1000)
      state.opponentPacts = [DRUMS]
      state.opponentPactWindows = [{ pact: DRUMS, expiresAtSec: 17.4 }]
      state.incomingAutoClicksPerSec = 3
      const html = render(state)
      // No duplicate shared card: the viewer's own card carries the window.
      expect(html).not.toContain('Shared treaties')
      const card = drumsCard(html)
      expect(card).toContain('Enemy’s treaty active for 7.4s')
      expect(card).toContain('+3 clicks/s for you')
      // The viewer's own window is closed, so the card still sells the activation.
      expect(card).toContain('300 🪵')
      expect(card).not.toContain('disabled')

      // With no enemy window open, nothing of theirs shows on the card.
      state.opponentPactWindows = []
      state.incomingAutoClicksPerSec = 0
      expect(drumsCard(render(state))).not.toContain('Enemy’s treaty')
    })
  })
})
