// Attack alert: an early warning of enemy active strikes, granted by
// the `attackAlert` effect and read by the server for the *victim*.

import { describe, expect, it } from 'vitest'
import type { ModeDefinition } from '../src/modes/types.js'
import type { AttackDefinition, EffectRef, PlayerState, UpgradeDefinition } from '../src/types.js'
import { NO_ATTACK_ALERT, collectAttackAlert, incomingAttacksWithin } from '../src/attacks.js'
import {
  createInitialState,
  getModeDefinition,
  validateModeDefinition,
} from '../src/modes/index.js'
import { applyEffect, prepareEffect } from '../src/effects/index.js'
import { isPrerequisiteSatisfied } from '../src/prerequisites.js'

// ─── Fixtures ────────────────────────────────────────────────────────

const STEAL: AttackDefinition = {
  id: 'a0',
  kind: 'active',
  prepareCost: { r0: { baseCost: 10 } },
  prepareTimeSec: 6,
  effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1 }],
}

function upgrade(id: string, effects: EffectRef[], extra: Partial<UpgradeDefinition> = {}) {
  return { id, cost: { r0: { baseCost: 10 } }, purchaseLimit: 1, effects, ...extra }
}

/** The idler's shape: a 5s base, +1s per level up to five, and a reveal. */
const ALERT = upgrade('alert', [{ type: 'attackAlert', leadSec: 5 }])
const LONGER = upgrade('longer', [{ type: 'attackAlert', leadSec: 1 }], { purchaseLimit: 5 })
const REVEAL = upgrade('reveal', [{ type: 'attackAlert', revealAttack: true }])
/** Both in one node. */
const ALERT_AND_REVEAL = upgrade('alert-and-reveal', [
  { type: 'attackAlert', leadSec: 2, revealAttack: true },
])
const PLAIN = upgrade('plain', [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 1 }])

const UPGRADES = [ALERT, LONGER, REVEAL, ALERT_AND_REVEAL, PLAIN]

function makeMode(effects: EffectRef[] = [], upgrades = UPGRADES): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades,
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [],
    attacks: [STEAL],
    pacts: [],
    effects,
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: upgrades.map((u) => ({ id: u.id, name: u.id, icon: '🛡️', description: '' })),
        generators: [],
        attacks: [{ id: 'a0', name: 'Steal', icon: '🪓', description: '' }],
        pacts: [],
      },
    ],
  }
}

function makeState(mode: ModeDefinition, owned: Record<string, number> = {}): PlayerState {
  const state = createInitialState(mode)
  Object.assign(state.upgrades, owned)
  return state
}

// ─── The effect ──────────────────────────────────────────────────────

describe('attackAlert effect', () => {
  it('echoes its grant, defaulting the absent half', () => {
    const mode = makeMode()
    const state = makeState(mode)
    expect(applyEffect({ type: 'attackAlert', leadSec: 5 }, state, mode)).toEqual({
      kind: 'attackAlert',
      leadSec: 5,
      revealAttack: false,
    })
    expect(applyEffect({ type: 'attackAlert', revealAttack: true }, state, mode)).toEqual({
      kind: 'attackAlert',
      leadSec: 0,
      revealAttack: true,
    })
  })

  it('rejects a grant of nothing, a non-positive lead, and unknown keys', () => {
    expect(() => prepareEffect({ type: 'attackAlert' })).toThrow()
    expect(() => prepareEffect({ type: 'attackAlert', revealAttack: false })).toThrow()
    expect(() => prepareEffect({ type: 'attackAlert', leadSec: 0 })).toThrow()
    expect(() => prepareEffect({ type: 'attackAlert', leadSec: -1 })).toThrow()
    expect(() => prepareEffect({ type: 'attackAlert', leadSec: 5, lead: 5 })).toThrow()
  })
})

// ─── collectAttackAlert ──────────────────────────────────────────────

describe('collectAttackAlert', () => {
  it('is the no-alert sentinel with nothing owned', () => {
    const mode = makeMode()
    expect(collectAttackAlert(makeState(mode), mode)).toBe(NO_ATTACK_ALERT)
    expect(collectAttackAlert(makeState(mode, { plain: 1 }), mode)).toBe(NO_ATTACK_ALERT)
  })

  it('sums leadSec × owned across upgrades', () => {
    const mode = makeMode()
    expect(collectAttackAlert(makeState(mode, { alert: 1 }), mode)).toEqual({
      leadSec: 5,
      revealAttack: false,
    })
    expect(collectAttackAlert(makeState(mode, { alert: 1, longer: 3 }), mode)).toEqual({
      leadSec: 8,
      revealAttack: false,
    })
  })

  it('folds a mode-level grant in once', () => {
    const mode = makeMode([{ type: 'attackAlert', leadSec: 2 }])
    expect(collectAttackAlert(makeState(mode), mode).leadSec).toBe(2)
    expect(collectAttackAlert(makeState(mode, { longer: 2 }), mode).leadSec).toBe(4)
  })

  it('reveals when any owned grant says so, and a reveal alone grants no lead', () => {
    const mode = makeMode()
    // Reveal with no lead: nothing to reveal on — still the sentinel.
    expect(collectAttackAlert(makeState(mode, { reveal: 1 }), mode)).toBe(NO_ATTACK_ALERT)
    expect(collectAttackAlert(makeState(mode, { alert: 1, reveal: 1 }), mode)).toEqual({
      leadSec: 5,
      revealAttack: true,
    })
    // Both halves on one node.
    expect(collectAttackAlert(makeState(mode, { 'alert-and-reveal': 1 }), mode)).toEqual({
      leadSec: 2,
      revealAttack: true,
    })
  })
})

// ─── incomingAttacksWithin ───────────────────────────────────────────

describe('incomingAttacksWithin', () => {
  const soon = { attack: 'a0', readyAtSec: 14 }
  const later = { attack: 'a0', readyAtSec: 30 }
  const attacker: PlayerState = {
    score: 0,
    resources: {},
    upgrades: {},
    generators: {},
    pendingAttacks: [soon, later],
    meta: { gameSec: 10 },
  }

  it('is empty with no lead, whatever is pending', () => {
    expect(incomingAttacksWithin(attacker, 10, NO_ATTACK_ALERT)).toEqual([])
    expect(incomingAttacksWithin(attacker, 10, { leadSec: 0, revealAttack: true })).toEqual([])
  })

  it('keeps the strikes due within the lead, inclusive at the boundary', () => {
    const alert = { leadSec: 4, revealAttack: false }
    expect(incomingAttacksWithin(attacker, 10, alert)).toEqual([soon]) // 4s left == lead
    expect(incomingAttacksWithin(attacker, 9, alert)).toEqual([]) // 5s left > lead
    expect(incomingAttacksWithin(attacker, 26, alert)).toEqual([soon, later])
  })

  it('is pure and preserves activation order', () => {
    const alert = { leadSec: 100, revealAttack: false }
    expect(incomingAttacksWithin(attacker, 0, alert)).toEqual([soon, later])
    expect(attacker.pendingAttacks).toHaveLength(2)
  })
})

// ─── Idler authoring ─────────────────────────────────────────────────

describe('idler early-warning nodes', () => {
  const idler = getModeDefinition('idler')
  const byId = new Map(idler.upgrades.map((u) => [u.id, u]))

  it('locks d-alert behind being hit once', () => {
    expect(byId.get('d-alert')?.prerequisites).toEqual({
      type: 'meta',
      key: 'attacksSuffered',
      min: 1,
    })
    const fresh = createInitialState(idler)
    expect(isPrerequisiteSatisfied(byId.get('d-alert')!.prerequisites, fresh)).toBe(false)
    fresh.meta.attacksSuffered = 1
    expect(isPrerequisiteSatisfied(byId.get('d-alert')!.prerequisites, fresh)).toBe(true)
  })

  it('grants a 5s lead, +1s per d-as level up to five, and a reveal from d-aa', () => {
    expect(byId.get('d-as')?.purchaseLimit).toBe(5)
    const state = createInitialState(idler)
    expect(collectAttackAlert(state, idler)).toBe(NO_ATTACK_ALERT)
    state.upgrades['d-alert'] = 1
    expect(collectAttackAlert(state, idler)).toEqual({ leadSec: 5, revealAttack: false })
    state.upgrades['d-as'] = 5
    state.upgrades['d-aa'] = 1
    expect(collectAttackAlert(state, idler)).toEqual({ leadSec: 10, revealAttack: true })
  })
})

// ─── Boot validation ─────────────────────────────────────────────────

describe('validateModeDefinition — attackAlert', () => {
  it('accepts a reveal when some grant in the mode gives a lead', () => {
    expect(() => {
      validateModeDefinition('test', makeMode())
    }).not.toThrow()
    expect(() => {
      validateModeDefinition('test', makeMode([{ type: 'attackAlert', leadSec: 1 }], [REVEAL]))
    }).not.toThrow()
  })

  it('rejects a reveal in a mode where nothing grants a lead', () => {
    expect(() => {
      validateModeDefinition('test', makeMode([], [REVEAL, PLAIN]))
    }).toThrow(
      /upgrade 'reveal' has an attackAlert reveal but no attackAlert in the mode grants a lead/,
    )
  })
})
