import type { PlayerState, UpgradeDefinition } from './types.js'

/** Whether an upgrade is still available to purchase within its mutually exclusive group. */
export function isChoiceGroupAvailable(
  upgrade: UpgradeDefinition,
  state: PlayerState,
  allUpgrades: readonly UpgradeDefinition[],
): boolean {
  if (!upgrade.choiceGroup) return true

  return !allUpgrades.some(
    (candidate) =>
      candidate.choiceGroup === upgrade.choiceGroup &&
      candidate.id !== upgrade.id &&
      (state.upgrades[candidate.id] ?? 0) > 0,
  )
}

/** Validate choice-group metadata in upgrade definitions. */
export function validateUpgradeChoiceGroups(upgrades: readonly UpgradeDefinition[]): void {
  for (const upgrade of upgrades) {
    if (upgrade.choiceGroup === undefined) continue
    if (upgrade.choiceGroup.trim() === '') {
      throw new Error(`[choiceGroups] upgrade '${upgrade.id}' has empty choiceGroup`)
    }
  }
}
