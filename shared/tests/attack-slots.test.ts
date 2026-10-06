// Attack slots: a budget on how many attacks of each kind a player
// can hold, enforced as a purchase gate on `unlockAttack` upgrades.

import { describe, expect, it } from 'vitest'
import type { ModeDefinition } from '../src/modes/types.js'
import type { AttackDefinition, EffectRef, PlayerState, UpgradeDefinition } from '../src/types.js'
import {
  attackLimit,
  attackSlotsHeld,
  hasAttackSlotsFor,
  isAttackKindCapped,
} from '../src/attacks.js'
import { isValidPurchase, purchaseBlockReason } from '../src/purchase-validation.js'
import {
  createInitialState,
  getModeDefinition,
  unlockedAttacks,
  validateModeDefinition,
} from '../src/modes/index.js'
import { applyEffect } from '../src/effects/index.js'

// ─── Fixtures ────────────────────────────────────────────────────────

const ACTIVE_A: AttackDefinition = { id: 'a0', kind: 'active' }
const ACTIVE_B: AttackDefinition = { id: 'a1', kind: 'active' }
const PASSIVE_A: AttackDefinition = { id: 'p0', kind: 'passive' }
const PASSIVE_B: AttackDefinition = { id: 'p1', kind: 'passive' }
const ATTACKS = [ACTIVE_A, ACTIVE_B, PASSIVE_A, PASSIVE_B]

function upgrade(id: string, effects: EffectRef[], extra: Partial<UpgradeDefinition> = {}) {
  return { id, cost: { r0: { baseCost: 10 } }, purchaseLimit: 1, effects, ...extra }
}

const UNLOCK_A0 = upgrade('unlock-a0', [{ type: 'unlockAttack', attack: 'a0' }])
const UNLOCK_A1 = upgrade('unlock-a1', [{ type: 'unlockAttack', attack: 'a1' }])
const UNLOCK_P0 = upgrade('unlock-p0', [{ type: 'unlockAttack', attack: 'p0' }])
const UNLOCK_P1 = upgrade('unlock-p1', [{ type: 'unlockAttack', attack: 'p1' }])
/** A second route to a0 — the same attack, so it must not cost a second slot. */
const UNLOCK_A0_AGAIN = upgrade('unlock-a0-again', [{ type: 'unlockAttack', attack: 'a0' }])
/** Unlocks both actives at once — all-or-nothing against the budget. */
const UNLOCK_BOTH = upgrade('unlock-both', [
  { type: 'unlockAttack', attack: 'a0' },
  { type: 'unlockAttack', attack: 'a1' },
])
/** +1 active slot per level, up to three levels. */
const SLOT_ACTIVE = upgrade(
  'slot-active',
  [{ type: 'attackSlots', attackKind: 'active', value: 1 }],
  {
    purchaseLimit: 3,
  },
)
/** Adds a slot and fills it in one purchase — legal at the cap. */
const SLOT_AND_UNLOCK = upgrade('slot-and-unlock', [
  { type: 'attackSlots', attackKind: 'active', value: 1 },
  { type: 'unlockAttack', attack: 'a1' },
])
/** A production node — never slot-blocked. */
const PLAIN = upgrade('plain', [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 1 }])
/** Mutually exclusive siblings, one of which unlocks an attack. */
const CHOICE_UNLOCK = upgrade('choice-unlock', [{ type: 'unlockAttack', attack: 'a1' }], {
  choiceGroup: 'branch',
})
const CHOICE_OTHER = upgrade('choice-other', [], { choiceGroup: 'branch' })
/** Gated behind `plain`. */
const GATED_UNLOCK = upgrade('gated-unlock', [{ type: 'unlockAttack', attack: 'a1' }], {
  prerequisites: { type: 'upgrade', id: 'plain' },
})

const UPGRADES = [
  UNLOCK_A0,
  UNLOCK_A1,
  UNLOCK_P0,
  UNLOCK_P1,
  UNLOCK_A0_AGAIN,
  UNLOCK_BOTH,
  SLOT_ACTIVE,
  SLOT_AND_UNLOCK,
  PLAIN,
  CHOICE_UNLOCK,
  CHOICE_OTHER,
  GATED_UNLOCK,
]

/** One active slot from the mode; passives uncapped unless `effects` says otherwise. */
const ONE_ACTIVE: EffectRef[] = [{ type: 'attackSlots', attackKind: 'active', value: 1 }]

function makeMode(effects: EffectRef[] = ONE_ACTIVE, upgrades = UPGRADES): ModeDefinition {
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
    attacks: ATTACKS,
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
        upgrades: upgrades.map((u) => ({ id: u.id, name: u.id, icon: '⚙️', description: '' })),
        generators: [],
        attacks: ATTACKS.map((a) => ({ id: a.id, name: a.id, icon: '⚔️', description: '' })),
        pacts: [],
      },
    ],
  }
}

function upgradeMap(mode: ModeDefinition): ReadonlyMap<string, UpgradeDefinition> {
  return new Map(mode.upgrades.map((u) => [u.id, u]))
}

/** A rich player who owns `owned`, so only the slot rule can block a buy. */
function makeState(mode: ModeDefinition, owned: Record<string, number> = {}): PlayerState {
  const state = createInitialState(mode)
  state.resources.r0 = 1e6
  Object.assign(state.upgrades, owned)
  return state
}

// ─── attackLimit / isAttackKindCapped ────────────────────────────────

describe('attackLimit', () => {
  it('is Infinity for a kind no attackSlots effect in the mode names', () => {
    const mode = makeMode()
    expect(isAttackKindCapped(mode, 'passive')).toBe(false)
    expect(attackLimit(makeState(mode), mode, 'passive')).toBe(Infinity)
  })

  it('is Infinity for both kinds in a mode that authors no slots at all', () => {
    // Every slot grant stripped — the idler as it was before slots were authored.
    const mode = makeMode(
      [],
      UPGRADES.filter((u) => !u.effects.some((e) => e.type === 'attackSlots')),
    )
    expect(isAttackKindCapped(mode, 'active')).toBe(false)
    expect(attackLimit(makeState(mode), mode, 'active')).toBe(Infinity)
    expect(hasAttackSlotsFor(makeState(mode), UNLOCK_BOTH, mode)).toBe(true)
  })

  it('reads the base from the mode-level starting effects', () => {
    const mode = makeMode([{ type: 'attackSlots', attackKind: 'active', value: 2 }])
    expect(isAttackKindCapped(mode, 'active')).toBe(true)
    expect(attackLimit(makeState(mode), mode, 'active')).toBe(2)
  })

  it('adds value × owned for every owned slot upgrade', () => {
    const mode = makeMode()
    expect(attackLimit(makeState(mode, { 'slot-active': 2 }), mode, 'active')).toBe(3)
  })

  it('caps a kind at zero when its only grant sits on an unbought upgrade', () => {
    // Zero is representable by omission: the panel can exist while the first
    // slot is itself a purchase.
    const mode = makeMode([])
    expect(isAttackKindCapped(mode, 'active')).toBe(true)
    expect(attackLimit(makeState(mode), mode, 'active')).toBe(0)
    expect(attackLimit(makeState(mode, { 'slot-active': 1 }), mode, 'active')).toBe(1)
  })

  it('keeps the two kinds’ budgets independent', () => {
    const mode = makeMode([
      { type: 'attackSlots', attackKind: 'active', value: 1 },
      { type: 'attackSlots', attackKind: 'passive', value: 4 },
    ])
    const state = makeState(mode, { 'slot-active': 3 })
    expect(attackLimit(state, mode, 'active')).toBe(4)
    expect(attackLimit(state, mode, 'passive')).toBe(4)
  })
})

// ─── attackSlotsHeld ─────────────────────────────────────────────────

describe('attackSlotsHeld', () => {
  it('counts the unlocked attacks of that kind only', () => {
    const mode = makeMode()
    const state = makeState(mode, { 'unlock-a0': 1, 'unlock-p0': 1, 'unlock-p1': 1 })
    expect(attackSlotsHeld(state, mode, 'active')).toBe(1)
    expect(attackSlotsHeld(state, mode, 'passive')).toBe(2)
  })

  it('counts an attack once however many upgrades unlock it', () => {
    const mode = makeMode()
    const state = makeState(mode, { 'unlock-a0': 1, 'unlock-a0-again': 1 })
    expect(attackSlotsHeld(state, mode, 'active')).toBe(1)
  })

  it('counts an attack the mode’s starting effects grant', () => {
    const mode = makeMode([...ONE_ACTIVE, { type: 'unlockAttack', attack: 'a0' }])
    const state = makeState(mode)
    expect(unlockedAttacks(state, mode)).toEqual(['a0'])
    expect(attackSlotsHeld(state, mode, 'active')).toBe(1)
    // …and it fills the one slot, so no further active can be bought.
    expect(hasAttackSlotsFor(state, UNLOCK_A1, mode)).toBe(false)
  })
})

// ─── hasAttackSlotsFor ───────────────────────────────────────────────

describe('hasAttackSlotsFor', () => {
  const mode = makeMode()

  it('allows an unlock while a slot is free', () => {
    expect(hasAttackSlotsFor(makeState(mode), UNLOCK_A0, mode)).toBe(true)
  })

  it('blocks an unlock at the cap', () => {
    expect(hasAttackSlotsFor(makeState(mode, { 'unlock-a0': 1 }), UNLOCK_A1, mode)).toBe(false)
  })

  it('allows a second route to an attack already held (no double charge)', () => {
    expect(hasAttackSlotsFor(makeState(mode, { 'unlock-a0': 1 }), UNLOCK_A0_AGAIN, mode)).toBe(true)
  })

  it('is all-or-nothing for an upgrade unlocking two attacks with one slot free', () => {
    expect(hasAttackSlotsFor(makeState(mode), UNLOCK_BOTH, mode)).toBe(false)
    expect(hasAttackSlotsFor(makeState(mode, { 'slot-active': 1 }), UNLOCK_BOTH, mode)).toBe(true)
  })

  it('is unaffected by the other kind’s budget', () => {
    // Actives full; passives uncapped.
    const state = makeState(mode, { 'unlock-a0': 1 })
    expect(hasAttackSlotsFor(state, UNLOCK_P0, mode)).toBe(true)
    expect(hasAttackSlotsFor(state, UNLOCK_P1, mode)).toBe(true)
  })

  it('never blocks an upgrade with no unlockAttack effect', () => {
    expect(hasAttackSlotsFor(makeState(mode, { 'unlock-a0': 1 }), PLAIN, mode)).toBe(true)
    expect(hasAttackSlotsFor(makeState(mode, { 'unlock-a0': 1 }), SLOT_ACTIVE, mode)).toBe(true)
  })

  it('lets a node add a slot and fill it in the same purchase', () => {
    expect(hasAttackSlotsFor(makeState(mode, { 'unlock-a0': 1 }), SLOT_AND_UNLOCK, mode)).toBe(true)
  })

  it('opens up again once a slot upgrade is owned', () => {
    expect(
      hasAttackSlotsFor(makeState(mode, { 'unlock-a0': 1, 'slot-active': 1 }), UNLOCK_A1, mode),
    ).toBe(true)
  })
})

// ─── purchaseBlockReason ─────────────────────────────────────────────

describe("purchaseBlockReason — 'attack-slots'", () => {
  const mode = makeMode()
  const map = upgradeMap(mode)

  it('returns attack-slots at the cap, and isValidPurchase agrees', () => {
    const state = makeState(mode, { 'unlock-a0': 1 })
    expect(purchaseBlockReason(state, 'unlock-a1', map, mode)).toBe('attack-slots')
    expect(isValidPurchase(state, 'unlock-a1', map, mode)).toBe(false)
  })

  it('passes once a slot is free', () => {
    expect(purchaseBlockReason(makeState(mode), 'unlock-a1', map, mode)).toBeNull()
  })

  it('ranks the slot rule ahead of the transient unaffordable', () => {
    const state = makeState(mode, { 'unlock-a0': 1 })
    state.resources.r0 = 0
    expect(purchaseBlockReason(state, 'unlock-a1', map, mode)).toBe('attack-slots')
  })

  it('reports the more fundamental reason first', () => {
    const full = { 'unlock-a0': 1 }
    expect(
      purchaseBlockReason(makeState(mode, { ...full, 'unlock-a1': 1 }), 'unlock-a1', map, mode),
    ).toBe('maxed')
    expect(purchaseBlockReason(makeState(mode, full), 'gated-unlock', map, mode)).toBe(
      'prerequisite',
    )
    expect(
      purchaseBlockReason(
        makeState(mode, { ...full, 'choice-other': 1 }),
        'choice-unlock',
        map,
        mode,
      ),
    ).toBe('choice-group')
  })

  it('never slot-blocks an upgrade that unlocks nothing', () => {
    const state = makeState(mode, { 'unlock-a0': 1 })
    expect(purchaseBlockReason(state, 'plain', map, mode)).toBeNull()
    expect(purchaseBlockReason(state, 'slot-active', map, mode)).toBeNull()
  })
})

// ─── validateModeDefinition ──────────────────────────────────────────

describe('validateModeDefinition — attack slots', () => {
  it('throws when the starting effects unlock more of a kind than the base cap holds', () => {
    const mode = makeMode([
      ...ONE_ACTIVE,
      { type: 'unlockAttack', attack: 'a0' },
      { type: 'unlockAttack', attack: 'a1' },
    ])
    expect(() => {
      validateModeDefinition('test', mode)
    }).toThrow(/unlock 2 slot\(s\) of active attacks but grant only 1 active attack slot\(s\)/)
  })

  it('throws when a kind capped only by an upgrade starts with an attack of that kind', () => {
    // Base 0 (the grant is on `slot-active`), one starting active → over budget.
    const mode = makeMode([{ type: 'unlockAttack', attack: 'a0' }])
    expect(() => {
      validateModeDefinition('test', mode)
    }).toThrow(/grant only 0 active attack slot\(s\)/)
  })

  it('accepts starting unlocks that exactly fill the base cap', () => {
    const mode = makeMode([...ONE_ACTIVE, { type: 'unlockAttack', attack: 'a0' }])
    expect(() => {
      validateModeDefinition('test', mode)
    }).not.toThrow()
  })

  it('accepts a starting unlock of an uncapped kind', () => {
    const mode = makeMode([...ONE_ACTIVE, { type: 'unlockAttack', attack: 'p0' }])
    expect(() => {
      validateModeDefinition('test', mode)
    }).not.toThrow()
  })

  it('accepts a mode capping one kind but not the other', () => {
    expect(() => {
      validateModeDefinition('test', makeMode(ONE_ACTIVE))
    }).not.toThrow()
  })
})

// ─── attackSlots params ──────────────────────────────────────────────

describe('slot cost', () => {
  /** a1 weighs 2; a0 stays at the default 1. Three active slots from the mode. */
  const HEAVY_B: AttackDefinition = { ...ACTIVE_B, slotCost: 2 }
  function weighted(
    effects: EffectRef[] = [{ type: 'attackSlots', attackKind: 'active', value: 2 }],
  ) {
    return { ...makeMode(effects), attacks: [ACTIVE_A, HEAVY_B, PASSIVE_A, PASSIVE_B] }
  }
  const owning = (...ids: string[]): PlayerState => {
    const state = createInitialState(weighted())
    for (const id of ids) state.upgrades[id] = 1
    return state
  }
  const byId = (mode: ModeDefinition, id: string) => mode.upgrades.find((u) => u.id === id)!

  it('counts held slots by weight, a route once', () => {
    const mode = weighted()
    expect(attackSlotsHeld(owning('unlock-a1'), mode, 'active')).toBe(2)
    expect(
      attackSlotsHeld(owning('unlock-a0', 'unlock-a1', 'unlock-a0-again'), mode, 'active'),
    ).toBe(3)
  })

  it('refuses a heavy unlock with too few slots free, and allows it with enough', () => {
    const mode = weighted()
    // Two slots, one filled by a0: a1 (weight 2) does not fit.
    expect(hasAttackSlotsFor(owning('unlock-a0'), byId(mode, 'unlock-a1'), mode)).toBe(false)
    expect(purchaseBlockReason(owning('unlock-a0'), 'unlock-a1', upgradeMap(mode), mode)).toBe(
      'attack-slots',
    )
    // Nothing held: it fits exactly.
    expect(hasAttackSlotsFor(owning(), byId(mode, 'unlock-a1'), mode)).toBe(true)
    // A second route to the held heavy attack charges nothing.
    const withBoth = {
      ...mode,
      upgrades: [...mode.upgrades, upgrade('route-a1', [{ type: 'unlockAttack', attack: 'a1' }])],
    }
    expect(hasAttackSlotsFor(owning('unlock-a1'), byId(withBoth, 'route-a1'), withBoth)).toBe(true)
  })

  it('sums the weights of everything one purchase unlocks', () => {
    const mode = weighted([{ type: 'attackSlots', attackKind: 'active', value: 2 }])
    // a0 + a1 = 3 slots > 2.
    expect(hasAttackSlotsFor(owning(), byId(mode, 'unlock-both'), mode)).toBe(false)
  })

  it('counts a raise bought in the same purchase', () => {
    const mode = weighted([{ type: 'attackSlots', attackKind: 'active', value: 2 }])
    // One held (a0), one free, +1 from the node itself = room for a1's 2.
    expect(hasAttackSlotsFor(owning('unlock-a0'), byId(mode, 'slot-and-unlock'), mode)).toBe(true)
  })

  describe('validation', () => {
    const valid = (mode: ModeDefinition) => () => {
      validateModeDefinition('test', mode)
    }

    it('accepts a weight the base alone covers, or one reachable through raises', () => {
      expect(valid(weighted())).not.toThrow()
      // Base 1 + three levels of slot-active = 4 ≥ 2.
      expect(
        valid(weighted([{ type: 'attackSlots', attackKind: 'active', value: 1 }])),
      ).not.toThrow()
    })

    it('throws for a weight beyond every reachable limit', () => {
      const mode = {
        ...weighted(),
        attacks: [ACTIVE_A, { ...ACTIVE_B, slotCost: 14 }, PASSIVE_A, PASSIVE_B],
      }
      // Base 2 + slot-active 3 + slot-and-unlock 1 = 6 < 14.
      expect(valid(mode)).toThrow(
        /active attack 'a1' takes 14 slot\(s\) but at most 6 active attack slot\(s\) can ever be granted/,
      )
    })

    it('counts only the most generous raise of a choice group', () => {
      // Base 1; two exclusive raises of +2 — a player ends at 3, never 5.
      const raise = (id: string, value: number) =>
        upgrade(id, [{ type: 'attackSlots', attackKind: 'active', value }], {
          choiceGroup: 'branch',
        })
      const base: EffectRef[] = [{ type: 'attackSlots', attackKind: 'active', value: 1 }]
      const withBranch = (slotCost: number) => ({
        ...makeMode(base, [UNLOCK_A0, raise('raise-left', 2), raise('raise-right', 2)]),
        attacks: [ACTIVE_A, { ...ACTIVE_B, slotCost }, PASSIVE_A, PASSIVE_B],
      })
      expect(valid(withBranch(3))).not.toThrow()
      expect(valid(withBranch(4))).toThrow(
        /active attack 'a1' takes 4 slot\(s\) but at most 3 active attack slot\(s\) can ever be granted/,
      )
    })

    it('grants nothing through a coming-soon raise, which still caps its kind', () => {
      const soon = upgrade('soon', [{ type: 'attackSlots', attackKind: 'passive', value: 5 }], {
        comingSoon: true,
      })
      const mode = {
        ...makeMode([{ type: 'attackSlots', attackKind: 'active', value: 2 }], [UNLOCK_P0, soon]),
        attacks: [ACTIVE_A, ACTIVE_B, { ...PASSIVE_A, slotCost: 2 }, PASSIVE_B],
      }
      // Passive is capped (the node names it) at a reachable 0, so p0 can never be held.
      expect(valid(mode)).toThrow(
        /passive attack 'p0' takes 2 slot\(s\) but at most 0 passive attack slot\(s\) can ever be granted/,
      )
    })

    it('never throws when a raise is unlimited', () => {
      const unlimited = weighted().upgrades.map((u) =>
        u.id === 'slot-active' ? { ...u, purchaseLimit: Infinity } : u,
      )
      const mode = {
        ...weighted(),
        upgrades: unlimited,
        attacks: [ACTIVE_A, { ...ACTIVE_B, slotCost: 14 }, PASSIVE_A, PASSIVE_B],
      }
      expect(valid(mode)).not.toThrow()
    })

    it('ignores a weight on an uncapped kind', () => {
      const mode = {
        ...weighted(),
        attacks: [ACTIVE_A, ACTIVE_B, { ...PASSIVE_A, slotCost: 99 }, PASSIVE_B],
      }
      expect(valid(mode)).not.toThrow()
    })

    it('sums starting unlocks by weight', () => {
      const mode = weighted([
        { type: 'attackSlots', attackKind: 'active', value: 1 },
        { type: 'unlockAttack', attack: 'a1' },
      ])
      expect(valid(mode)).toThrow(/unlock 2 slot\(s\) of active attacks but grant only 1/)
    })

    it('throws for a programmatic weight that is not a positive whole number', () => {
      for (const slotCost of [0, 1.5]) {
        const mode = {
          ...weighted(),
          attacks: [ACTIVE_A, { ...ACTIVE_B, slotCost }, PASSIVE_A, PASSIVE_B],
        }
        expect(valid(mode)).toThrow(/slotCost .* positive whole number/)
      }
    })
  })
})

describe('attackSlots params', () => {
  const mode = makeMode()
  const state = createInitialState(mode)

  it('echoes the authored grant', () => {
    expect(
      applyEffect({ type: 'attackSlots', attackKind: 'passive', value: 2 }, state, mode),
    ).toEqual({ kind: 'attackSlots', attackKind: 'passive', value: 2 })
  })

  it('rejects a non-positive or fractional value', () => {
    for (const value of [0, -1, 1.5]) {
      expect(() =>
        applyEffect({ type: 'attackSlots', attackKind: 'active', value }, state, mode),
      ).toThrow()
    }
  })

  it('rejects an unknown attack kind', () => {
    expect(() =>
      applyEffect({ type: 'attackSlots', attackKind: 'ranged', value: 1 }, state, mode),
    ).toThrow()
  })
})

// ─── The idler’s authored base cap ───────────────────────────────────

describe('idler attack slots', () => {
  it('opens the round with 3 active and 4 passive slots, none held', () => {
    const idler = getModeDefinition('idler')
    const state = createInitialState(idler)
    expect(attackLimit(state, idler, 'active')).toBe(3)
    expect(attackLimit(state, idler, 'passive')).toBe(4)
    expect(attackSlotsHeld(state, idler, 'active')).toBe(0)
    expect(attackSlotsHeld(state, idler, 'passive')).toBe(0)
  })
})
