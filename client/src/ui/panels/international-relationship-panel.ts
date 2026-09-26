import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import {
  getModeDefinition,
  getModeFlavor,
  getPactDescription,
  getPactIcon,
  getPactName,
  getResourceIcon,
  unlockedPacts,
} from '@game/shared'
import type { ModeDefinition, ModeFlavor, Modifier, PactBonus, PactDefinition } from '@game/shared'
import { formatDecimal, formatMultiplier } from '../format-number.js'

/** Cache of last rendered HTML to avoid unnecessary DOM churn on update(). */
let prevHtml = ''

/** Placeholder shown until the viewer unlocks a pact via an `unlockPact` upgrade. */
function renderLocked(): string {
  return `
    <div class="panel-placeholder">
      <span class="placeholder-icon">🤝</span>
      <p>No pacts unlocked yet — research the relations tree to unlock one.</p>
    </div>
  `
}

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
function worthLine(m: Modifier, modeDef: ModeDefinition, flavor: ModeFlavor): string {
  const amount =
    m.stage === 'multiplicative'
      ? `+${formatDecimal((m.value - 1) * 100, 1)}%`
      : `+${formatMultiplier(m.value)}`
  return `<li class="pact-worth">${amount} ${targetLabel(m.field, modeDef, flavor)}</li>`
}

/**
 * The discount line for one pact — `−25% on 3 upgrades the enemy already
 * owns` — from the stamped cost factors tagged with it. Entities are counted
 * per scope; a growth-only discount reads as such, since the price the card
 * quotes only moves at the next level.
 */
function discountLines(state: Readonly<GameState>, pactId: string): string {
  const mine = (state.player.pactCostFactors ?? []).filter((f) => f.pact === pactId)
  if (mine.length === 0) return ''
  const lines: string[] = []
  for (const scope of ['upgrade', 'generator'] as const) {
    const entries = mine.filter((f) => f.scope === scope)
    if (entries.length === 0) continue
    const noun = scope === 'upgrade' ? 'upgrade' : 'generator'
    const what = `${entries.length} ${noun}${entries.length === 1 ? '' : 's'} the enemy already owns`
    // Every entry of one pact carries the same authored factors, so the first
    // speaks for all of them.
    const [first] = entries
    if (first.costFactor !== undefined && first.costFactor !== 1)
      lines.push(
        `<li class="pact-worth">−${formatDecimal((1 - first.costFactor) * 100, 1)}% on ${what}</li>`,
      )
    if (first.scalingFactor !== undefined && first.scalingFactor !== 1)
      lines.push(
        `<li class="pact-worth">−${formatDecimal((1 - first.scalingFactor) * 100, 1)}% price growth on ${what}</li>`,
      )
  }
  return lines.join('')
}

/**
 * One pact card: flavor, a mutual badge, and what the treaty is worth right
 * now — the resolved bonuses the server sent for it, plus any discount stamped
 * under its name. A pact carrying effects that currently resolve to nothing
 * says so, so an unlocked treaty never looks like a dead card.
 */
function renderCard(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
  pact: PactDefinition,
  bonus: PactBonus | undefined,
): string {
  const desc = getPactDescription(flavor, pact.id)
  const worth = (bonus?.modifiers ?? []).map((m) => worthLine(m, modeDef, flavor)).join('')
  const discounts = discountLines(state, pact.id)
  const lines = worth + discounts
  const hasEffects = (pact.effects?.length ?? 0) > 0
  const body =
    lines !== ''
      ? `<ul class="pact-worth-list">${lines}</ul>`
      : hasEffects
        ? `<span class="pact-worth pact-worth--none">no bonus yet</span>`
        : ''
  return `
    <li class="pact-item" data-pact="${pact.id}">
      <div class="pact-card">
        <span class="pact-icon">${getPactIcon(flavor, pact.id)}</span>
        <span class="pact-name">${getPactName(flavor, pact.id)}${pact.mutual ? ' <span class="pact-mutual">🤝 mutual</span>' : ''}</span>
        ${desc ? `<span class="pact-desc">${desc}</span>` : ''}
        ${body}
      </div>
    </li>
  `
}

/**
 * The active-pact block — an active pact has no behavior yet, so each
 * is a disabled, no-op button: unlocking one only makes it appear here.
 */
function renderActiveSection(flavor: ModeFlavor, pacts: readonly string[]): string {
  const items = pacts
    .map((id) => {
      const desc = getPactDescription(flavor, id)
      return `
        <li class="pact-item">
          <button class="pact-btn" type="button" disabled>
            <span class="pact-icon">${getPactIcon(flavor, id)}</span>
            <span class="pact-name">${getPactName(flavor, id)}</span>
            ${desc ? `<span class="pact-desc">${desc}</span>` : ''}
          </button>
        </li>
      `
    })
    .join('')
  return renderSection('Active', items)
}

function renderSection(heading: string, items: string): string {
  return `
    <section class="pact-section">
      <h3 class="pact-heading">${heading}</h3>
      <ul class="pact-list">${items}</ul>
    </section>
  `
}

/** The opponent's mutual treaties that pay this player — styled apart, since they were not this player's choice. */
function renderSharedSection(items: string): string {
  return `
    <section class="pact-section pact-shared">
      <h3 class="pact-heading">Shared treaties</h3>
      <ul class="pact-list">${items}</ul>
    </section>
  `
}

function renderRelations(state: Readonly<GameState>): string {
  if (!state.mode) return ''
  const modeDef = getModeDefinition(state.mode)
  const unlocked = unlockedPacts(state.player, modeDef)
  const shared = state.opponentPacts
  if (unlocked.length === 0 && shared.length === 0) return renderLocked()

  const pactById = new Map(modeDef.pacts.map((p) => [p.id, p]))
  const bonusById = new Map(state.pactBonuses.map((b) => [b.pact, b]))
  const active = unlocked.filter((id) => pactById.get(id)?.kind === 'active')
  const passive = unlocked.filter((id) => pactById.get(id)?.kind === 'passive')

  const flavor = getModeFlavor(modeDef)
  const card = (id: string): string => {
    const pact = pactById.get(id)
    return pact ? renderCard(state, modeDef, flavor, pact, bonusById.get(id)) : ''
  }
  // The opponent's mutual treaties pay this player too, but the ones this
  // player has also signed are already on their own card.
  const sharedOnly = shared.filter((id) => !unlocked.includes(id))
  return `
    ${active.length > 0 ? renderActiveSection(flavor, active) : ''}
    ${passive.length > 0 ? renderSection('Passive', passive.map(card).join('')) : ''}
    ${sharedOnly.length > 0 ? renderSharedSection(sharedOnly.map(card).join('')) : ''}
  `
}

/**
 * International Relationship panel — lists pacts the viewer has unlocked via
 * `unlockPact` effects, with what each is worth right now, plus the
 * opponent's mutual treaties that pay the viewer too. The panel tab itself is
 * gated by a `panelUnlock` upgrade targeting its id
 * (`'international-relationship'`); see `getModeUI`. Individual pacts are
 * hidden until an owning upgrade unlocks them (`isPactUnlocked`).
 */
export const internationalRelationshipPanel: Panel = {
  id: 'international-relationship',
  label: 'Relations',
  icon: '🤝',

  render(container, state) {
    const html = renderRelations(state)
    prevHtml = html
    container.innerHTML = `<div class="pact-content" id="pact-content">${html}</div>`
  },

  update(state) {
    const html = renderRelations(state)
    if (html === prevHtml) return
    prevHtml = html
    const content = document.getElementById('pact-content')
    if (content) content.innerHTML = html
  },
}
