import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doActivatePact } from '../../game.js'
import {
  activePactExpiresAtSec,
  cooldownUntilSec,
  getModeDefinition,
  getModeFlavor,
  getPactActivationCost,
  getPactDescription,
  getPactIcon,
  getPactName,
  getResourceIcon,
  pactAutoClicksPerSec,
  pactBlockReason,
  pactLimit,
  pactSlotsHeld,
  readGameSec,
  unlockedPacts,
} from '@game/shared'
import type {
  ModeDefinition,
  ModeFlavor,
  Modifier,
  PactBonus,
  PactDefinition,
  PactKind,
} from '@game/shared'
import { formatDecimal, formatMultiplier, formatNumber } from '../format-number.js'
import { countdownSpan } from '../counters.js'
import { renderSlotsBadge } from '../components.js'

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
  // An opponent's window reaching this player: its countdown and its gift.
  const windowLines = sharedWindowLines(state, modeDef, pact)
  const body =
    lines !== ''
      ? `${windowLines}<ul class="pact-worth-list">${lines}</ul>`
      : windowLines !== ''
        ? windowLines
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
 * An active pact's activation cost with resource icons; or, when the player
 * is short, `held/needed` per currency so the shortfall shows — the attack
 * card's two cost states.
 */
function renderPactCost(
  resources: Readonly<Record<string, number>>,
  flavor: ModeFlavor,
  pact: PactDefinition,
  short: boolean,
): string {
  const entries = Object.entries(getPactActivationCost(pact))
  if (entries.length === 0) return ''
  const parts = entries
    .map(([res, amt]) => {
      const icon = getResourceIcon(flavor, res)
      return short
        ? `${formatNumber(resources[res] ?? 0)}/${formatNumber(amt)} ${icon}`
        : `${formatNumber(amt)} ${icon}`
    })
    .join(' + ')
  return `<span class="pact-status${short ? ' pact-status--blocked' : ''}">${parts}</span>`
}

/**
 * One active-pact card: a button with the attack card's lifecycle — active
 * (window open: countdown plus what it is worth now), cooling down (the rest
 * after it), blocked, short of the cost, or the price. A click activates it.
 */
function renderActiveCard(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
  pact: PactDefinition,
  bonus: PactBonus | undefined,
): string {
  const id = pact.id
  const desc = getPactDescription(flavor, id)
  const gameSec = readGameSec(state.player)
  const expiresAt = activePactExpiresAtSec(state.player, id)
  const coolingUntil = expiresAt === null ? cooldownUntilSec(state.player, 'pact', id) : null
  const reason = pactBlockReason(state.player, id, modeDef)
  const worth = (bonus?.modifiers ?? []).map((m) => worthLine(m, modeDef, flavor)).join('')
  const status =
    expiresAt !== null
      ? `<span class="pact-status pact-status--active">${countdownSpan({ template: 'Active for {}s', untilSec: expiresAt }, gameSec)}</span>${worth ? `<ul class="pact-worth-list">${worth}</ul>` : ''}`
      : coolingUntil !== null
        ? `<span class="pact-status pact-status--cooling">${countdownSpan({ template: 'Ready in {}s', untilSec: coolingUntil }, gameSec)}</span>`
        : reason === 'no-effects'
          ? `<span class="pact-status pact-status--blocked">No effect yet</span>`
          : renderPactCost(state.player.resources, flavor, pact, reason === 'unaffordable')
  return `
    <li class="pact-item" data-pact="${id}">
      <button class="pact-btn${expiresAt !== null ? ' active' : coolingUntil !== null ? ' cooling' : ''}" type="button"${reason !== null ? ' disabled' : ''}>
        <span class="pact-icon">${getPactIcon(flavor, id)}</span>
        <span class="pact-name">${getPactName(flavor, id)}${pact.mutual ? ' <span class="pact-mutual">🤝 mutual</span>' : ''}</span>
        ${desc ? `<span class="pact-desc">${desc}</span>` : ''}
        ${status}
        ${sharedWindowLines(state, modeDef, pact, 'Enemy’s treaty active for {}s')}
      </button>
    </li>
  `
}

/**
 * What an opponent's active-pact window is doing for this player: how long it
 * stays open, and — for a pact carrying `partnerAutoClick` — the clicks it is
 * granting (or why it grants none). Shown on the shared-treaty card of a pact
 * this player has not signed, and under the status of their own active card
 * when they have (the two windows are independent, so the `template` names
 * whose this is). Empty when no window of `pact` is open on the other side.
 */
function sharedWindowLines(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  pact: PactDefinition,
  template = 'Active for {}s',
): string {
  const window = state.opponentPactWindows.find((w) => w.pact === pact.id)
  if (!window) return ''
  const gameSec = readGameSec(state.player)
  const lines = [
    `<span class="pact-status pact-status--active">${countdownSpan({ template, untilSec: window.expiresAtSec }, gameSec)}</span>`,
  ]
  // Judged by what the treaty's effects output, not by their names.
  const gifts = pactAutoClicksPerSec(pact, state.player, modeDef) > 0
  if (gifts)
    lines.push(
      state.incomingAutoClicksPerSec > 0
        ? `<span class="pact-worth">+${formatDecimal(state.incomingAutoClicksPerSec, 1)} clicks/s for you</span>`
        : `<span class="pact-worth pact-worth--none">free clicks — unlock clicking to use them</span>`,
    )
  return lines.join('')
}

/** The `held / limit` badge for one kind's heading, or nothing for an uncapped kind. */
function renderSlots(state: Readonly<GameState>, modeDef: ModeDefinition, kind: PactKind): string {
  return renderSlotsBadge(
    pactSlotsHeld(state.player, modeDef, kind),
    pactLimit(state.player, modeDef, kind),
    'pact-slots',
  )
}

/** `(heading, slots, items)` — the attack panel's order, so the two never drift. */
function renderSection(heading: string, slots: string, items: string): string {
  return `
    <section class="pact-section">
      <h3 class="pact-heading">${heading}${slots}</h3>
      <ul class="pact-list">${items}</ul>
    </section>
  `
}

/** The opponent's treaties that reach this player — styled apart, since they were not this player's choice. */
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
  const activeCard = (id: string): string => {
    const pact = pactById.get(id)
    return pact ? renderActiveCard(state, modeDef, flavor, pact, bonusById.get(id)) : ''
  }
  // The opponent's treaties that reach this player get a shared card — unless
  // this player has also signed the pact, whose own card then carries the
  // worth (passive) or the enemy's open window (active) instead.
  const sharedOnly = shared.filter((id) => !unlocked.includes(id))
  return `
    ${active.length > 0 ? renderSection('Active', renderSlots(state, modeDef, 'active'), active.map(activeCard).join('')) : ''}
    ${passive.length > 0 ? renderSection('Passive', renderSlots(state, modeDef, 'passive'), passive.map(card).join('')) : ''}
    ${sharedOnly.length > 0 ? renderSharedSection(sharedOnly.map(card).join('')) : ''}
  `
}

/**
 * International Relationship panel — lists pacts the viewer has unlocked via
 * `unlockPact` effects, with what each is worth right now (active pacts as
 * buttons that activate them), plus the opponent's treaties that reach the
 * viewer — mutual ones, and open windows carrying a gift. The panel tab itself is
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

  bind() {
    const content = document.getElementById('pact-content')
    if (!content || content.dataset.delegated) return
    content.dataset.delegated = 'true'
    content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pact-btn')
      if (!btn || btn.disabled) return
      const id = btn.closest<HTMLElement>('.pact-item[data-pact]')?.dataset.pact
      if (id) doActivatePact(id)
    })
  },

  update(state) {
    const html = renderRelations(state)
    if (html === prevHtml) return
    prevHtml = html
    const content = document.getElementById('pact-content')
    if (content) content.innerHTML = html
  },
}
