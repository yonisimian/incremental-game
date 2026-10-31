import { getResourceIcon } from '@game/shared'
import type { ModeDefinition, ModeFlavor, Modifier } from '@game/shared'
import type { GameState } from '../game.js'
import { formatDecimal, formatMultiplier } from './format-number.js'

// What a pact is worth, in words — shared by the relations panel's cards and
// the data panel's pact rows, so the two can never describe a treaty apart.

/** What a bonus lands on, in flavor terms: a resource icon, or the special tracks. */
function targetLabel(field: string, modeDef: ModeDefinition, flavor: ModeFlavor): string {
  if (field === 'clickIncome') return 'per click'
  if (field === 'highlightFactor') return 'highlight'
  if (modeDef.resources.includes(field)) return `${getResourceIcon(flavor, field)} production`
  return field
}

/**
 * One resolved bonus as a "worth now" line — `+12% 🪵 production`, `+0.4 per
 * click`. A multiplicative bonus reads as the percentage over 1 (its `cap` is
 * authored in the same terms), an additive one as the flat amount.
 */
export function pactWorthText(m: Modifier, modeDef: ModeDefinition, flavor: ModeFlavor): string {
  const amount =
    m.stage === 'multiplicative'
      ? `+${formatDecimal((m.value - 1) * 100, 1)}%`
      : `+${formatMultiplier(m.value)}`
  return `${amount} ${targetLabel(m.field, modeDef, flavor)}`
}

/**
 * The discount lines for one pact — `−25% on 3 upgrades the enemy already
 * owns` — from the stamped cost factors tagged with it. Entities are counted
 * per scope; a growth-only discount reads as such, since the price the card
 * quotes only moves at the next level.
 */
export function pactDiscountTexts(state: Readonly<GameState>, pactId: string): string[] {
  const mine = (state.player.pactCostFactors ?? []).filter((f) => f.pact === pactId)
  const lines: string[] = []
  for (const scope of ['upgrade', 'generator'] as const) {
    const entries = mine.filter((f) => f.scope === scope)
    if (entries.length === 0) continue
    const what = `${entries.length} ${scope}${entries.length === 1 ? '' : 's'} the enemy already owns`
    // Every entry of one pact carries the same authored factors, so the first
    // speaks for all of them.
    const [first] = entries
    if (first.costFactor !== undefined && first.costFactor !== 1)
      lines.push(`−${formatDecimal((1 - first.costFactor) * 100, 1)}% on ${what}`)
    if (first.scalingFactor !== undefined && first.scalingFactor !== 1)
      lines.push(`−${formatDecimal((1 - first.scalingFactor) * 100, 1)}% price growth on ${what}`)
  }
  return lines
}
