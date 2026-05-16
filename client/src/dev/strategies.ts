/**
 * Idler strategy definitions for the dev panel simulator.
 *
 * Strategies are ordered sequences of actions (buy upgrade or set highlight).
 * The simulator drains actions in order, waiting for affordability before
 * proceeding to the next buy action.
 *
 * Upgrade IDs:
 *   u0 = Sharpened Axes (SA)  — 30 wood, highlight boost → 4×
 *   u1 = Heavy Logging  (HL)  — 25 wood, +5 wood/sec
 *   u2 = Royal Brewery  (RB)  — 25 ale,  +5 ale/sec
 *   u3 = Master Craftsmen (MC) — 10 ale, unlimited, prereq: u2, +5 wood/sec ea
 *   u4 = Industrial Era (IE)  — 50 wood, prereqs: u1+u0+u2, all ×1.25
 *   u5 = Royal Throne   (RT)  — 1000 wood, prereq: u4, trophy (buy-upgrade goal)
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface StrategyAction {
  type: 'buy' | 'set_highlight'
  upgradeId?: string
  highlight?: string
}

export interface Strategy {
  name: string
  actions: StrategyAction[]
}

// ─── Helpers ─────────────────────────────────────────────────────────

const buy = (upgradeId: string): StrategyAction => ({ type: 'buy', upgradeId })
const hl = (h: string): StrategyAction => ({ type: 'set_highlight', highlight: h })

// ─── Upgrade abbreviations (for chart markers & table display) ──────

export const UPGRADE_ABBR: Record<string, string> = {
  u0: 'SA',
  u1: 'HL',
  u2: 'RB',
  u3: 'MC',
  u4: 'IE',
  u5: 'RT',
}

// ─── Idler Strategies ────────────────────────────────────────────────

export const IDLER_STRATEGIES: readonly Strategy[] = [
  {
    name: 'No upgrades',
    actions: [hl('wood')],
  },
  {
    name: 'SA only',
    actions: [hl('wood'), buy('u0')],
  },
  {
    name: 'HL only',
    actions: [hl('wood'), buy('u1')],
  },
  {
    name: 'SA→HL',
    actions: [hl('wood'), buy('u0'), buy('u1')],
  },
  {
    name: 'HL→SA',
    actions: [hl('wood'), buy('u1'), buy('u0')],
  },
  {
    name: 'RB→MC×1→SA→HL',
    actions: [hl('ale'), buy('u2'), buy('u3'), hl('wood'), buy('u0'), buy('u1')],
  },
  {
    name: 'RB→MC×2→SA→HL',
    actions: [hl('ale'), buy('u2'), buy('u3'), buy('u3'), hl('wood'), buy('u0'), buy('u1')],
  },
  {
    name: 'RB→MC×3→SA→HL',
    actions: [
      hl('ale'),
      buy('u2'),
      buy('u3'),
      buy('u3'),
      buy('u3'),
      hl('wood'),
      buy('u0'),
      buy('u1'),
    ],
  },
  {
    name: 'SA→HL→RB→IE',
    actions: [hl('wood'), buy('u0'), buy('u1'), hl('ale'), buy('u2'), hl('wood'), buy('u4')],
  },
  {
    name: 'RB→MC×1→SA→HL→IE',
    actions: [hl('ale'), buy('u2'), buy('u3'), hl('wood'), buy('u0'), buy('u1'), buy('u4')],
  },
  {
    name: 'RB→MC×2→SA→HL→IE',
    actions: [
      hl('ale'),
      buy('u2'),
      buy('u3'),
      buy('u3'),
      hl('wood'),
      buy('u0'),
      buy('u1'),
      buy('u4'),
    ],
  },
  {
    name: 'RB only',
    actions: [hl('ale'), buy('u2'), hl('wood')],
  },
  {
    name: 'RB→MC×1',
    actions: [hl('ale'), buy('u2'), buy('u3'), hl('wood')],
  },
]
