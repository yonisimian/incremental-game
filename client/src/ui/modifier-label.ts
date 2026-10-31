import {
  ALL_GENERATORS_FIELD,
  ALL_RESOURCES_FIELD,
  getGeneratorIcon,
  getGeneratorName,
  getResourceIcon,
  HIGHLIGHT_FACTOR_TARGET,
  INCOMING_CLICK_INCOME_FIELD,
} from '@game/shared'
import type { ModeDefinition, ModeFlavor } from '@game/shared'

/**
 * What a modifier's `field` lands on, in flavor terms — `🪵 production`,
 * `🪵 base`, `🪓 Woodcutter`, `per click`, `✨ highlight`. The one wording for
 * every bonus and debuff the client lists (live bonuses, pact worth, the debuffs
 * on the player), so a field never reads two ways on one screen. An unknown
 * field falls back to its id.
 */
export function modifierTargetLabel(
  field: string,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
): string {
  if (field === 'clickIncome' || field === INCOMING_CLICK_INCOME_FIELD) return 'per click'
  if (field === HIGHLIGHT_FACTOR_TARGET) return '✨ highlight'
  if (field === ALL_RESOURCES_FIELD) return 'all production'
  if (field === ALL_GENERATORS_FIELD) return 'all generators'
  const baseIndex = /^b(\d+)$/.exec(field)?.[1]
  if (baseIndex !== undefined) {
    const resource = modeDef.resources[Number(baseIndex)]
    return resource ? `${getResourceIcon(flavor, resource)} base` : field
  }
  if (modeDef.resources.includes(field)) return `${getResourceIcon(flavor, field)} production`
  if (modeDef.generators.some((g) => g.id === field)) {
    return `${getGeneratorIcon(flavor, field)} ${getGeneratorName(flavor, field)}`
  }
  return field
}
