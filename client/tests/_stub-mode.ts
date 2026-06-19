import { getModeDefinition } from '@game/shared'
import type { ModeDefinition, UpgradeDefinition } from '@game/shared'

/**
 * Synthetic "Phase-0" idler stub tree used by the dev-tooling unit tests
 * (simulator, strategy generator, tree renderer).
 *
 * These tests validate engine mechanics against a small, stable economy and
 * must NOT couple to the real idler tree, which is large and still evolving.
 *
 * Economy (mirrors the historical idler stub):
 *   - base 1 r0/s + 1 r1/s (from the real mode's nativeModifiers)
 *   - uh:  cost 5 r0,  one-shot, ×2 highlight multiplier (unlocks highlight)
 *   - uh2: cost 10 r0, one-shot, ×1.5 highlight multiplier, requires uh
 *   - u1:  cost 25 r0, one-shot, +5 r0/s additive
 *   - u5:  trophy (buy-upgrade goal), cost 1000 r0
 */
export const stubUpgrades: UpgradeDefinition[] = [
  {
    id: 'uh',
    cost: { r0: 5 },
    purchaseLimit: 1,
    modifiers: [],
    effects: [{ type: 'highlightMultiplier', multiplier: 2 }],
    position: { x: 0, y: 0 },
  },
  {
    id: 'uh2',
    cost: { r0: 10 },
    purchaseLimit: 1,
    modifiers: [],
    effects: [{ type: 'highlightMultiplier', multiplier: 1.5 }],
    prerequisites: { type: 'upgrade', id: 'uh' },
    position: { x: 0, y: 150 },
  },
  {
    id: 'u1',
    cost: { r0: 25 },
    purchaseLimit: 1,
    modifiers: [{ stage: 'additive', field: 'r0', value: 5 }],
    position: { x: 200, y: 0 },
  },
  {
    id: 'u5',
    cost: { r0: 1000 },
    purchaseLimit: 1,
    modifiers: [],
    position: { x: 600, y: 0 },
    goalType: 'buy-upgrade',
  },
]

/**
 * The real idler mode definition with its upgrade tree replaced by
 * `stubUpgrades` and the highlight-unlock pointed at `uh`. All other mechanics
 * (resources, native income, goals, tick wiring) come from the real mode.
 */
export const stubMode: ModeDefinition = {
  ...getModeDefinition('idler'),
  highlightUnlockUpgrade: 'uh',
  upgrades: stubUpgrades,
}
