import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doActivateAttack } from '../../game.js'
import {
  attackBlockReason,
  collectAttackParams,
  getAttackDescription,
  getAttackIcon,
  getAttackName,
  getAttackPrepareCost,
  getAttackPrepareTimeSec,
  getModeDefinition,
  getModeFlavor,
  getResourceIcon,
  unlockedAttacks,
} from '@game/shared'
import type {
  AttackBlockReason,
  AttackDefinition,
  AttackParams,
  ModeDefinition,
  ModeFlavor,
} from '@game/shared'
import { formatDecimal, formatMultiplier, formatNumber } from '../format-number.js'

/** Cache of last rendered HTML to avoid unnecessary DOM churn on update(). */
let prevHtml = ''

/** Placeholder shown until the viewer unlocks an attack via an `unlockAttack` upgrade. */
function renderLocked(): string {
  return `
    <div class="panel-placeholder">
      <span class="placeholder-icon">⚔️</span>
      <p>No attacks unlocked yet — research the attack tree to unlock one.</p>
    </div>
  `
}

/**
 * The prepare cost of an active attack, formatted with resource icons — at the
 * price the viewer actually pays, `attackStat` discounts included.
 */
function renderCost(flavor: ModeFlavor, def: AttackDefinition, params: AttackParams): string {
  const entries = Object.entries(getAttackPrepareCost(def, params))
  if (entries.length === 0) return ''
  const parts = entries
    .map(([res, amt]) => `${formatNumber(amt)} ${getResourceIcon(flavor, res)}`)
    .join(' + ')
  return `<span class="attack-cost">${parts}</span>`
}

/**
 * The attack's *current* numbers, where owned `attackStat` upgrades have moved
 * them off the authored ones.
 *
 * The authored description keeps describing the attack's shape ("Steal 10% of the
 * enemy's wood"); this line carries what the multipliers make of it, so a card
 * can't read as though the upgrade did nothing. `prepareCost` is deliberately
 * absent — the cost row above already quotes the discounted price, so repeating
 * it as a factor would say the same thing twice.
 *
 * The delay is reported as **resolved seconds**, not as a factor: an `offset`
 * stat shifts it in seconds, which no multiplier can express, and the number a
 * player acts on is the wait itself.
 *
 * Only `power` is shown for a **passive** attack. A passive attack is never
 * activated, so it has neither a prepare cost nor a prepare delay
 * (`validateModeDefinition` forbids it from declaring either, and forbids an
 * `attackStat` from moving either on it).
 */
function renderStats(def: AttackDefinition, params: AttackParams): string {
  const parts: string[] = []
  if (params.power !== 1) parts.push(`Power ×${formatMultiplier(params.power)}`)
  if (def.kind === 'active') {
    const authored = def.prepareTimeSec ?? 0
    const resolved = getAttackPrepareTimeSec(def, params)
    if (resolved !== authored) parts.push(`Prep ${formatDecimal(resolved, 1)}s`)
  }
  if (parts.length === 0) return ''
  return `<span class="attack-stats">${parts.join(' · ')}</span>`
}

/** The seconds remaining before a pending strike lands, in game seconds. */
function pendingRemaining(state: Readonly<GameState>, id: string): number | null {
  const pending = state.player.pendingAttacks.find((p) => p.attack === id)
  if (!pending) return null
  const gameSec = (state.player.meta.gameSec as number | undefined) ?? 0
  return Math.max(0, pending.readyAtSec - gameSec)
}

/** Short label describing why an active attack can't be activated right now. */
function blockLabel(reason: AttackBlockReason): string {
  switch (reason) {
    case 'unaffordable':
      return 'Not enough resources'
    case 'no-effects':
      return 'No effect yet'
    default:
      return ''
  }
}

/** One active-attack card: a clickable button showing cost, state, or countdown. */
function renderActiveAttack(
  state: Readonly<GameState>,
  flavor: ModeFlavor,
  modeDef: ModeDefinition,
  id: string,
): string {
  const desc = getAttackDescription(flavor, id)
  const def = modeDef.attacks.find((a) => a.id === id)
  if (!def) return ''
  const params = collectAttackParams(state.player, modeDef, id)
  const remaining = pendingRemaining(state, id)
  const preparing = remaining !== null
  const reason = attackBlockReason(state.player, id, modeDef)
  const disabled = preparing || reason !== null
  const status = preparing
    ? `<span class="attack-status attack-status--preparing">Striking in ${remaining.toFixed(1)}s</span>`
    : reason
      ? `<span class="attack-status attack-status--blocked">${blockLabel(reason)}</span>`
      : renderCost(flavor, def, params)
  return `
    <li class="attack-item" data-attack="${id}">
      <button class="attack-btn${preparing ? ' preparing' : ''}" type="button"${disabled ? ' disabled' : ''}>
        <span class="attack-icon">${getAttackIcon(flavor, id)}</span>
        <span class="attack-name">${getAttackName(flavor, id)}</span>
        ${desc ? `<span class="attack-desc">${desc}</span>` : ''}
        ${status}
        ${renderStats(def, params)}
      </button>
    </li>
  `
}

/**
 * One passive-attack card: always-on, so shown as a non-interactive info card.
 * A passive attack has no cost or delay to quote, but its debuff is scaled by
 * `power` just like a strike is — so the derived line belongs here too, carrying
 * that one stat.
 */
function renderPassiveAttack(
  state: Readonly<GameState>,
  flavor: ModeFlavor,
  modeDef: ModeDefinition,
  id: string,
): string {
  const desc = getAttackDescription(flavor, id)
  const def = modeDef.attacks.find((a) => a.id === id)
  if (!def) return ''
  return `
    <li class="attack-item">
      <button class="attack-btn" type="button" disabled>
        <span class="attack-icon">${getAttackIcon(flavor, id)}</span>
        <span class="attack-name">${getAttackName(flavor, id)}</span>
        ${desc ? `<span class="attack-desc">${desc}</span>` : ''}
        ${renderStats(def, collectAttackParams(state.player, modeDef, id))}
      </button>
    </li>
  `
}

function renderSection(heading: string, items: string): string {
  return `
    <section class="attack-section">
      <h3 class="attack-heading">${heading}</h3>
      <ul class="attack-list">${items}</ul>
    </section>
  `
}

function renderAttack(state: Readonly<GameState>): string {
  if (!state.mode) return ''
  const modeDef = getModeDefinition(state.mode)
  const unlocked = unlockedAttacks(state.player, modeDef)
  if (unlocked.length === 0) return renderLocked()

  // Split unlocked attacks into their kinds so each renders in its own block.
  const kindOf = new Map(modeDef.attacks.map((a) => [a.id, a.kind]))
  const active = unlocked.filter((id) => kindOf.get(id) === 'active')
  const passive = unlocked.filter((id) => kindOf.get(id) === 'passive')

  const flavor = getModeFlavor(modeDef)
  const activeItems = active.map((id) => renderActiveAttack(state, flavor, modeDef, id)).join('')
  const passiveItems = passive.map((id) => renderPassiveAttack(state, flavor, modeDef, id)).join('')
  return `
    ${active.length > 0 ? renderSection('Active', activeItems) : ''}
    ${passive.length > 0 ? renderSection('Passive', passiveItems) : ''}
  `
}

/**
 * Attack panel — lists attacks the viewer has unlocked via `unlockAttack`
 * effects. The panel tab itself is gated by a `panelUnlock` upgrade targeting
 * its id (`'attack'`); see `getModeUI`. Individual attacks are hidden until an
 * owning upgrade unlocks them (`isAttackUnlocked`). Active attacks are clickable
 * (pay a prepare cost, then strike after a delay); passive ones are always-on.
 */
export const attackPanel: Panel = {
  id: 'attack',
  label: 'Attack',
  icon: '⚔️',

  render(container, state) {
    const html = renderAttack(state)
    prevHtml = html
    container.innerHTML = `<div class="attack-content" id="attack-content">${html}</div>`
  },

  bind() {
    const content = document.getElementById('attack-content')
    if (!content || content.dataset.delegated) return
    content.dataset.delegated = 'true'
    content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.attack-btn')
      if (!btn || btn.disabled) return
      const item = btn.closest<HTMLElement>('.attack-item[data-attack]')
      const id = item?.dataset.attack
      if (id) doActivateAttack(id)
    })
  },

  update(state) {
    const html = renderAttack(state)
    if (html === prevHtml) return
    prevHtml = html
    const content = document.getElementById('attack-content')
    if (content) content.innerHTML = html
  },
}
