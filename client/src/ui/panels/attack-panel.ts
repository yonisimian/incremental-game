import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doActivateAttack } from '../../game.js'
import {
  activeDebuffExpiresAtSec,
  attackBlockReason,
  attackLimit,
  attackSlotCost,
  attackSlotsHeld,
  collectAttackParams,
  cooldownUntilSec,
  getAttackCooldownSec,
  getAttackDescription,
  getAttackDurationSec,
  getAttackIcon,
  getAttackName,
  getAttackPrepareCost,
  getAttackPrepareTimeSec,
  getModeDefinition,
  getModeFlavor,
  getResourceIcon,
  isAttackKindCapped,
  readGameSec,
  unlockedAttacks,
} from '@game/shared'
import type {
  AttackBlockReason,
  AttackDefinition,
  AttackKind,
  AttackParams,
  ModeDefinition,
  ModeFlavor,
} from '@game/shared'
import { formatDecimal, formatMultiplier, formatNumber } from '../format-number.js'
import { countdownSpan } from '../counters.js'

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
 * The prepare cost of an unaffordable attack as `held/needed` per currency, so
 * the player sees the shortfall. Currencies already covered are marked `--met`.
 */
function renderShortfall(
  resources: Readonly<Record<string, number>>,
  flavor: ModeFlavor,
  def: AttackDefinition,
  params: AttackParams,
): string {
  const parts = Object.entries(getAttackPrepareCost(def, params))
    .map(([res, amt]) => {
      const held = resources[res] ?? 0
      const cls = held >= amt ? 'attack-cost-part attack-cost-part--met' : 'attack-cost-part'
      const icon = getResourceIcon(flavor, res)
      return `<span class="${cls}">${formatNumber(held)}/${formatNumber(amt)} ${icon}</span>`
    })
    .join(' + ')
  return `<span class="attack-status attack-status--blocked">${parts}</span>`
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
 * player acts on is the wait itself. The debuff window (`durationSec`) and the
 * cooldown (`cooldownSec`) are reported the same way, for the same reason.
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
    if (def.durationSec !== undefined) {
      const window = getAttackDurationSec(def, params)
      if (window !== def.durationSec) parts.push(`Lasts ${formatDecimal(window, 1)}s`)
    }
    if (def.cooldownSec !== undefined) {
      const rest = getAttackCooldownSec(def, params)
      if (rest !== def.cooldownSec) parts.push(`Cooldown ${formatDecimal(rest, 1)}s`)
    }
  }
  if (parts.length === 0) return ''
  return `<span class="attack-stats">${parts.join(' · ')}</span>`
}

/**
 * `◼ N` beside the name when the attack takes other than one slot of a capped
 * kind's budget — why one unlock ate several slots.
 */
function renderSlotCost(modeDef: ModeDefinition, def: AttackDefinition): string {
  const cost = attackSlotCost(def)
  if (cost === 1 || !isAttackKindCapped(modeDef, def.kind)) return ''
  return ` <span class="slot-cost" title="Takes ${cost} ${def.kind} slots">◼ ${cost}</span>`
}

/** Game-clock time a pending strike of `id` lands, or `null` when none is pending. */
function pendingReadyAt(state: Readonly<GameState>, id: string): number | null {
  return state.player.pendingAttacks.find((p) => p.attack === id)?.readyAtSec ?? null
}

/** Short label describing why an active attack can't be activated right now. */
function blockLabel(reason: AttackBlockReason): string {
  switch (reason) {
    case 'no-effects':
      return 'No effect yet'
    // `unaffordable` is rendered as a shortfall, and `already-active`,
    // `already-preparing` and `cooling-down` as countdowns, by the caller.
    default:
      return ''
  }
}

/**
 * One active-attack card: a clickable button showing cost, state, or countdown.
 * The status line has five states, checked in lifecycle order — preparing
 * (strike pending), active (debuff window open), cooling down (the rest after
 * the attack finished), blocked, or the price.
 */
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
  const gameSec = readGameSec(state.player)
  const readyAt = pendingReadyAt(state, id)
  const preparing = readyAt !== null
  const expiresAt = activeDebuffExpiresAtSec(state.player, id)
  // Behind an open window the rest is already stamped but not yet running, so
  // the window's countdown is the one to show.
  const coolingUntil = expiresAt === null ? cooldownUntilSec(state.player, 'attack', id) : null
  const reason = attackBlockReason(state.player, id, modeDef)
  const disabled = preparing || reason !== null
  const status = preparing
    ? `<span class="attack-status attack-status--preparing">${countdownSpan({ template: 'Striking in {}s', untilSec: readyAt }, gameSec)}</span>`
    : expiresAt !== null
      ? `<span class="attack-status attack-status--active">${countdownSpan({ template: 'Active for {}s', untilSec: expiresAt }, gameSec)}</span>`
      : coolingUntil !== null
        ? `<span class="attack-status attack-status--cooling">${countdownSpan({ template: 'Ready in {}s', untilSec: coolingUntil }, gameSec)}</span>`
        : reason === 'unaffordable'
          ? renderShortfall(state.player.resources, flavor, def, params)
          : reason
            ? `<span class="attack-status attack-status--blocked">${blockLabel(reason)}</span>`
            : renderCost(flavor, def, params)
  return `
    <li class="attack-item" data-attack="${id}">
      <button class="attack-btn${preparing ? ' preparing' : expiresAt !== null ? ' active' : coolingUntil !== null ? ' cooling' : ''}" type="button"${disabled ? ' disabled' : ''}>
        <span class="attack-icon">${getAttackIcon(flavor, id)}</span>
        <span class="attack-name">${getAttackName(flavor, id)}${renderSlotCost(modeDef, def)}</span>
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
        <span class="attack-name">${getAttackName(flavor, id)}${renderSlotCost(modeDef, def)}</span>
        ${desc ? `<span class="attack-desc">${desc}</span>` : ''}
        ${renderStats(def, collectAttackParams(state.player, modeDef, id))}
      </button>
    </li>
  `
}

/**
 * The `held / limit` slots line for one kind's heading — `Active 2 / 3` — or
 * nothing when the mode never caps that kind. Reads as a loadout
 * rather than an inventory: the player can see how many commitments remain.
 */
function renderSlots(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  kind: AttackKind,
): string {
  const limit = attackLimit(state.player, modeDef, kind)
  if (!Number.isFinite(limit)) return ''
  return ` <span class="attack-slots">${attackSlotsHeld(state.player, modeDef, kind)} / ${limit}</span>`
}

function renderSection(heading: string, slots: string, items: string): string {
  return `
    <section class="attack-section">
      <h3 class="attack-heading">${heading}${slots}</h3>
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
    ${active.length > 0 ? renderSection('Active', renderSlots(state, modeDef, 'active'), activeItems) : ''}
    ${passive.length > 0 ? renderSection('Passive', renderSlots(state, modeDef, 'passive'), passiveItems) : ''}
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
