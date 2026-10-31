import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { roundStats } from '../../stats/round-stats.js'
import { formatDecimal, formatMultiplier, formatNumber } from '../format-number.js'
import { describePurchaseTarget, formatCostSum, formatPercentChange, setText } from '../helpers.js'
import { attackLifecycle, pactLifecycle } from '../lifecycle.js'
import { modifierTargetLabel } from '../modifier-label.js'
import { countdownSpan } from '../counters.js'
import { pactDiscountTexts, pactWorthText } from '../pact-worth.js'
import { attackPanel } from './attack-panel.js'
import { internationalRelationshipPanel } from './international-relationship-panel.js'
import {
  type AttackDefinition,
  type AttackBlockReason,
  type AttackKind,
  type AttackParams,
  type DynamicBonus,
  type GeneratorOutput,
  type ModeDefinition,
  type ModeFlavor,
  type Modifier,
  type PactDefinition,
  type PactBlockReason,
  type PactKind,
  type PlayerState,
  type ResourceRateBreakdown,
  attackBlockReason,
  attackLimit,
  attackSlotsHeld,
  batteryFactor,
  collectAttackParams,
  getAttackCooldownSec,
  getAttackDurationSec,
  getAttackIcon,
  getAttackName,
  getAttackPrepareCost,
  getAttackPrepareTimeSec,
  getPactActivationCost,
  getPactIcon,
  getPactName,
  isAttackKindCapped,
  isPactKindCapped,
  isPanelUnlocked,
  openPactWindows,
  pactWindowOpenedAtSec,
  pactBlockReason,
  pactLimit,
  pactSlotsHeld,
  readGameSec,
  unlockedAttacks,
  unlockedPacts,
  collectBatteryParams,
  collectDynamicBonuses,
  collectGeneratorOutputs,
  collectModifiers,
  computeClickIncome,
  computeRateBreakdown,
  debuffedHighlightFactor,
  getHighlightMultiplier,
  isHighlightBatteryActive,
  readBatteryCharge,
  readHighlight,
  ATTACKS_SUFFERED_META_KEY,
  pactModifiers,
  resolveEnemyDebuffs,
  getModeDefinition,
  getModeFlavor,
  getGeneratorIcon,
  getGeneratorName,
  getResourceIcon,
  getResourceName,
  getUpgradeName,
} from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

// Rates keep a decimal here rather than going through `formatNumber` directly:
// every notation floors below 1000, which would report a +0.5/s generator as
// "+0/s" — the panel exists to be precise about exactly these numbers.

/** Format a per-second production rate (e.g. "+2/s", "+0.5/s", "-1/s"). */
function formatRate(rate: number): string {
  const sign = rate < 0 ? '-' : '+'
  return `${sign}${formatDecimal(Math.abs(rate), 1)}/s`
}

/** Format a rate without a leading sign (for breakdown sub-rows). */
function formatAmount(rate: number): string {
  return formatDecimal(rate, 1)
}

/**
 * A small quantity rendered faithfully (`0.25`, `9.5`, `20`).
 *
 * Every notation floors below 1000, so `formatNumber` turns a charge of 0.25 into
 * "0" and a drain of 0.73/s into "-0/s" — both actively misleading next to a
 * multiplier that is plainly still paying out. `formatMultiplier` is the existing
 * escape hatch from that flooring; the alias keeps the call sites honest about
 * what they're formatting.
 */
const formatQuantity = formatMultiplier

/** Percentage share of `part` out of `total` (0 when total is 0). */
function share(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (part / total) * 100))
}

/** Generators that produce the given resource, in mode order. */
function generatorsFor(modeDef: ModeDefinition, resource: string) {
  return modeDef.generators.filter((g) => g.production.resource === resource)
}

// ─── Collapsible sections ────────────────────────────────────────────
//
// Every section (and each resource's per-generator list) can be folded away.
// Keys are mode-agnostic (`prod:r0`, `gens:r0`, `inventory`, …) and the
// collapsed set is persisted, so the layout survives tab switches and rounds.

const COLLAPSE_STORAGE_KEY = 'data-panel-collapsed'

const collapsedKeys = loadCollapsed()

function loadCollapsed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

function saveCollapsed(): void {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsedKeys]))
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Fold/unfold the group a toggle button heads (its parent element), and
 * remember the choice. Collapsed content stays in the DOM — `updateNumbers`
 * keeps writing to it, so re-expanding shows live numbers immediately.
 */
function toggleCollapse(btn: HTMLElement): void {
  const key = btn.dataset.collapse
  const group = btn.parentElement
  if (!key || !group) return
  const isCollapsed = !group.classList.contains('collapsed')
  group.classList.toggle('collapsed', isCollapsed)
  btn.setAttribute('aria-expanded', String(!isCollapsed))
  if (isCollapsed) collapsedKeys.add(key)
  else collapsedKeys.delete(key)
  saveCollapsed()
}

// ─── Rendering ───────────────────────────────────────────────────────

/**
 * A collapsible section card: a clickable header (title + optional `summary`
 * HTML that stays visible while collapsed) over `body`. Exported for tests.
 */
export function renderSection(key: string, title: string, body: string, summary = ''): string {
  const isCollapsed = collapsedKeys.has(key)
  return `
    <section class="data-section${isCollapsed ? ' collapsed' : ''}">
      <button class="data-section-head" type="button" data-collapse="${key}" aria-expanded="${!isCollapsed}">
        <span class="data-section-title"><span class="data-caret" aria-hidden="true">▾</span> ${title}</span>
        ${summary}
      </button>
      <div class="data-section-body">${body}</div>
    </section>
  `
}

/**
 * The "Generators" source row. With generators declared for this resource the
 * row doubles as a toggle for the per-generator breakdown beneath it;
 * otherwise it's a plain row (nothing to fold).
 */
function renderGeneratorRow(modeDef: ModeDefinition, flavor: ModeFlavor, resource: string): string {
  const caret = ' <span class="data-caret" aria-hidden="true">▾</span>'
  const label = (withCaret: boolean): string =>
    `<span class="data-source-label"><i class="data-swatch data-swatch-gen"></i> Generators${withCaret ? caret : ''}</span>`
  const value = `<span id="data-src-gen-${resource}">—</span>`
  const gens = generatorsFor(modeDef, resource)
  if (gens.length === 0) {
    return `<div class="data-source-row">${label(false)}${value}</div>`
  }

  const key = `gens:${resource}`
  const isCollapsed = collapsedKeys.has(key)
  const genRows = gens
    .map(
      (g) => `
        <div class="data-gen-entry" id="data-gen-row-${resource}-${g.id}">
          <div class="data-gen-row">
            <span class="data-gen-name">${getGeneratorIcon(flavor, g.id)} ${getGeneratorName(flavor, g.id)}</span>
            <span class="data-gen-rate" id="data-gen-rate-${resource}-${g.id}">—</span>
          </div>
          <div class="data-gen-detail" id="data-gen-detail-${resource}-${g.id}">—</div>
        </div>`,
    )
    .join('')

  return `
    <div class="data-gen-group${isCollapsed ? ' collapsed' : ''}">
      <button class="data-source-row data-source-toggle" type="button" data-collapse="${key}" aria-expanded="${!isCollapsed}">
        ${label(true)}
        ${value}
      </button>
      <div class="data-gen-list">${genRows}</div>
    </div>
  `
}

/**
 * The parts behind a generator's rate, as one line:
 * `base 2/s ea · add +0.5/s ea · mult ×1.6 · shared ×1.43`.
 *
 * The first three are the generator's own numbers, per unit owned, so they stay
 * readable as the count grows: `(base + add) × owned × mult` is what it feeds
 * the pipeline. `shared` is what the resource-wide stages (highlight, global
 * bonuses, enemy debuffs) then do to it — shown only when it isn't ×1, so the
 * row's rate always reconciles with the parts.
 */
function generatorDetail(out: GeneratorOutput, delivered: number): string {
  const parts = [
    `base ${formatDecimal(out.ratePerUnit)}/s ea`,
    `add +${formatDecimal(out.additivePerUnit)}/s ea`,
    `mult ×${formatMultiplier(out.multiplier)}`,
  ]
  const shared = out.effective > 0 ? delivered / out.effective : 1
  if (Math.abs(shared - 1) > 0.005) parts.push(`shared ×${formatMultiplier(shared)}`)
  return parts.join(' · ')
}

// ─── Live bonuses ────────────────────────────────────────────────────
//
// Upgrades whose worth moves with the game state — a bank that scales with the
// stockpile, Socialism/Capitalism tracking generator ownership. Their cards can
// only state a rule ("1% per 1000 🪵"), so this section reports what the rule is
// paying right now. Rows are rebuilt (not patched) because both the upgrades on
// show and the fields they hit change during a round.

/** A modifier's current value ("×1.04", "+3"). */
function formatModifierValue(m: Modifier): string {
  return m.stage === 'additive' ? `+${formatAmount(m.value)}` : `×${formatMultiplier(m.value)}`
}

/**
 * One upgrade's live contribution. A bonus that hits every resource with the
 * same value (Socialism) collapses to a single "all" entry instead of repeating
 * itself per resource.
 */
function formatBonus(bonus: DynamicBonus, modeDef: ModeDefinition, flavor: ModeFlavor): string {
  const [first, ...rest] = bonus.modifiers
  const uniform = rest.every((m) => m.stage === first.stage && m.value === first.value)
  const coversEveryResource =
    bonus.modifiers.length === modeDef.resources.length &&
    modeDef.resources.every((r) => bonus.modifiers.some((m) => m.field === r))
  if (uniform && coversEveryResource && modeDef.resources.length > 1) {
    return `all ${formatModifierValue(first)}`
  }
  return bonus.modifiers
    .map((m) => `${modifierTargetLabel(m.field, modeDef, flavor)} ${formatModifierValue(m)}`)
    .join(', ')
}

/** The live-bonus rows for the current state (empty when nothing dynamic is active). */
function renderBonusRows(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
): string {
  return collectDynamicBonuses(state.player, modeDef)
    .map(
      (bonus) => `
        <div class="data-bonus-row">
          <span class="data-bonus-name">${getUpgradeName(flavor, bonus.upgradeId)}</span>
          <span class="data-bonus-value">${formatBonus(bonus, modeDef, flavor)}</span>
        </div>`,
    )
    .join('')
}

/** The HTML each rebuilt list last received, by element id (see {@link setListHtml}). */
const listHtml = new Map<string, string>()

/**
 * Replace a rebuilt list's HTML when it changed. Compared against what was
 * last written, not `innerHTML`: the counters painter rewrites countdown text
 * in place every frame, and the browser may re-serialize markup, so the DOM is
 * no reliable record of the last write.
 */
function setListHtml(id: string, html: string): void {
  if (listHtml.get(id) === html) return
  const el = document.getElementById(id)
  if (!el) return
  el.innerHTML = html
  listHtml.set(id, html)
}

// ─── Attacks and pacts ───────────────────────────────────────────────
//
// What this round's attacks and treaties have done, beside what they are doing
// now. A section shows once its system is in play — the mode declares it, and
// its tab is unlocked or the opponent's side of it is reaching this player — and
// is hidden (not empty) before. The player's own blocks (slots, the rows of
// what they hold) show only once their own tab is unlocked. Fixed rows are
// skeleton ids patched by update(); the per-item lists are rebuilt wholesale
// when their HTML changes, since items appear mid-round as they are unlocked.

const ATTACK_KINDS: readonly AttackKind[] = ['active', 'passive']
const PACT_KINDS: readonly PactKind[] = ['active', 'passive']

/** Show or hide the `.data-section` card holding element `id`. */
function setSectionShown(id: string, shown: boolean): void {
  const section = document.getElementById(id)?.closest<HTMLElement>('.data-section')
  if (section) section.style.display = shown ? '' : 'none'
}

/** Set an element's `hidden` flag. */
function setHidden(id: string, hidden: boolean): void {
  const el = document.getElementById(id)
  if (el) el.hidden = hidden
}

/** Seconds as the panel states them ("6s", "7.5s"). */
function formatSec(sec: number): string {
  return `${formatDecimal(sec, 1)}s`
}

/**
 * What a strike haul moved, as parts ("1.2K 🪵", "×2 🪚"), resources first in
 * mode order, then generators.
 */
function haulParts(
  haul: {
    readonly resources: Readonly<Record<string, number>>
    readonly generators: Readonly<Record<string, number>>
  },
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
): string[] {
  const parts: string[] = []
  for (const r of modeDef.resources) {
    const amount = haul.resources[r] ?? 0
    if (amount > 0) parts.push(`${formatNumber(amount)} ${getResourceIcon(flavor, r)}`)
  }
  for (const g of modeDef.generators) {
    const count = haul.generators[g.id] ?? 0
    if (count > 0) parts.push(`×${count} ${getGeneratorIcon(flavor, g.id)}`)
  }
  return parts
}

/** One list row: a name and status on top, detail lines beneath. */
function renderItem(name: string, status: string, details: readonly string[]): string {
  return `
        <div class="data-item">
          <div class="data-item-head">
            <span class="data-item-name">${name}</span>
            <span class="data-item-status">${status}</span>
          </div>
          ${details.map((d) => `<div class="data-item-detail">${d}</div>`).join('')}
        </div>`
}

/**
 * `held / limit` stat cells for each kind the mode caps, under element `id`
 * (shown with the player's own blocks); empty when no kind is capped.
 */
function renderSlotCells(id: string, prefix: string, kinds: readonly string[]): string {
  if (kinds.length === 0) return ''
  const cells = kinds
    .map(
      (kind) => `
          <div class="data-stat">
            <span class="data-stat-label">${kind === 'active' ? 'Active' : 'Passive'} slots</span>
            <span class="data-stat-value" id="data-${prefix}-slots-${kind}">—</span>
          </div>`,
    )
    .join('')
  return `<div class="data-stat-grid" id="${id}">${cells}</div>`
}

/**
 * An attack's status: its timed phase when it is in one (the card's
 * countdown), otherwise whether it can be paid for. A passive attack is simply
 * always on.
 */
function attackStatus(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  def: AttackDefinition,
  params: AttackParams,
): string {
  if (def.kind === 'passive') return 'Always on'
  const reason = attackBlockReason(state.player, def.id, modeDef, params)
  const life = attackLifecycle(state.player, def.id, reason)
  if (life) return countdownSpan(life, readGameSec(state.player))
  return readinessLabel(reason)
}

/**
 * The status of an activation in no timed phase, from its block reason —
 * attacks and pacts share these reasons and their wording.
 */
function readinessLabel(reason: AttackBlockReason | PactBlockReason | null): string {
  switch (reason) {
    case null:
      return 'Ready'
    case 'unaffordable':
      return 'Short of cost'
    case 'no-effects':
      return 'No effect yet'
    default:
      return ''
  }
}

/**
 * An attack's resolved numbers — every one, not only those an upgrade moved
 * (the attack card's rule): this panel is where a player checks what the
 * multipliers add up to. Passive attacks carry only `power`.
 */
function attackStatsLine(flavor: ModeFlavor, def: AttackDefinition, params: AttackParams): string {
  const parts: string[] = []
  if (def.kind === 'active') {
    const cost = formatCostSum(getAttackPrepareCost(def, params), flavor)
    if (cost !== '') parts.push(`cost ${cost}`)
    parts.push(`prep ${formatSec(getAttackPrepareTimeSec(def, params))}`)
    if (def.durationSec !== undefined)
      parts.push(`lasts ${formatSec(getAttackDurationSec(def, params))}`)
    if (def.cooldownSec !== undefined)
      parts.push(`cooldown ${formatSec(getAttackCooldownSec(def, params))}`)
  }
  parts.push(`power ×${formatMultiplier(params.power)}`)
  return parts.join(' · ')
}

/** What an active attack's strikes have done this round, from the server's events. */
function attackTallyLine(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
  attackId: string,
): string {
  const tally = roundStats.outgoingAttack(attackId)
  if (!tally) return 'No strikes yet'
  const parts = [
    `${tally.strikes} strike${tally.strikes === 1 ? '' : 's'}${tally.misses > 0 ? ` (${tally.misses} missed)` : ''}`,
  ]
  const stolen = haulParts(tally, modeDef, flavor)
  if (stolen.length > 0) parts.push(`stole ${stolen.join(', ')}`)
  const debuffSec = roundStats.outgoingDebuffSec(attackId, readGameSec(state.player))
  if (debuffSec > 0) parts.push(`debuffed ${formatSec(debuffSec)}`)
  return parts.join(' · ')
}

/** One row per attack this player holds, active first. */
function renderAttackRows(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
): string {
  const held = new Set(unlockedAttacks(state.player, modeDef))
  const defs = modeDef.attacks.filter((a) => held.has(a.id))
  return [...defs.filter((a) => a.kind === 'active'), ...defs.filter((a) => a.kind === 'passive')]
    .map((def) => {
      const params = collectAttackParams(state.player, modeDef, def.id)
      const details = [attackStatsLine(flavor, def, params)]
      if (def.kind === 'active') details.push(attackTallyLine(state, modeDef, flavor, def.id))
      return renderItem(
        `${getAttackIcon(flavor, def.id)} ${getAttackName(flavor, def.id)}`,
        attackStatus(state, modeDef, def, params),
        details,
      )
    })
    .join('')
}

/** A debuff's value with its sign ("×0.9", "-2"). */
function formatDebuffValue(m: Modifier): string {
  if (m.stage !== 'additive') return `×${formatMultiplier(m.value)}`
  return `${m.value < 0 ? '-' : '+'}${formatAmount(Math.abs(m.value))}`
}

/** One "On you now" row: what is hit, and how. */
function renderNowRow(name: string, value: string): string {
  return `
        <div class="data-bonus-row">
          <span class="data-bonus-name">${name}</span>
          <span class="data-bonus-value data-value-debuffed">${value}</span>
        </div>`
}

/**
 * What the enemy's attacks are doing to this player right now — debuffs on
 * their production, inflated prices, purchase locks — or empty when nothing is.
 */
function renderIncomingNow(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
): string {
  const gameSec = readGameSec(state.player)
  const rows = state.debuffs.map((m) =>
    renderNowRow(modifierTargetLabel(m.field, modeDef, flavor), formatDebuffValue(m)),
  )
  for (const entry of state.player.incomingCostFactors ?? []) {
    const what = `💸 ${describePurchaseTarget(flavor, entry.scope, entry.id)}`
    if (entry.costFactor !== undefined && entry.costFactor !== 1)
      rows.push(renderNowRow(what, `+${formatPercentChange(entry.costFactor)}% cost`))
    if (entry.scalingFactor !== undefined && entry.scalingFactor !== 1)
      rows.push(renderNowRow(what, `+${formatPercentChange(entry.scalingFactor)}% growth`))
  }
  for (const lock of state.player.incomingPurchaseLocks ?? []) {
    rows.push(
      renderNowRow(
        `🔒 ${describePurchaseTarget(flavor, lock.scope, lock.id)}`,
        countdownSpan({ template: '{}s', untilSec: lock.untilSec }, gameSec),
      ),
    )
  }
  if (rows.length === 0) return ''
  return `<p class="data-subhead">On you now</p><div class="data-bonus-list">${rows.join('')}</div>`
}

/** Whether any of the enemy's attacks has reached this player this round, or is now. */
function isAttackedNow(state: Readonly<GameState>): boolean {
  const player = state.player
  return (
    readAttacksSuffered(player) > 0 ||
    state.debuffs.length > 0 ||
    (player.incomingCostFactors?.length ?? 0) > 0 ||
    (player.incomingPurchaseLocks?.length ?? 0) > 0
  )
}

/** How many enemy active strikes have landed on this player (`meta.attacksSuffered`). */
function readAttacksSuffered(player: Readonly<PlayerState>): number {
  // `meta` is untyped wire data: validated like the game clock (`readGameSec`).
  const raw = player.meta[ATTACKS_SUFFERED_META_KEY]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/** The ⚔️ Attacks section skeleton (filled by {@link updateAttacks}); empty for a mode without attacks. */
function renderAttacksSection(modeDef: ModeDefinition, flavor: ModeFlavor): string {
  if (modeDef.attacks.length === 0) return ''
  const lostRows = modeDef.resources
    .map(
      (r) => `
          <div class="data-stat">
            <span class="data-stat-label">${getResourceIcon(flavor, r)} ${getResourceName(flavor, r)} lost</span>
            <span class="data-stat-value" id="data-atk-in-lost-${r}">—</span>
          </div>`,
    )
    .join('')
  const capped = ATTACK_KINDS.filter((k) => isAttackKindCapped(modeDef, k))
  return renderSection(
    'attacks',
    '⚔️ Attacks',
    `
        <div id="data-attacks">
          ${renderSlotCells('data-atk-slots', 'atk', capped)}
          <div id="data-atk-own">
            <p class="data-subhead">Yours</p>
            <div class="data-item-list" id="data-atk-list"></div>
          </div>
          <p class="data-subhead">Incoming</p>
          <div class="data-stat-grid">
            <div class="data-stat">
              <span class="data-stat-label">Strikes suffered</span>
              <span class="data-stat-value" id="data-atk-in-strikes">—</span>
            </div>
            <div class="data-stat">
              <span class="data-stat-label">🏭 Generators lost</span>
              <span class="data-stat-value" id="data-atk-in-gens">—</span>
            </div>
            ${lostRows}
            <div class="data-stat">
              <span class="data-stat-label">Time debuffed</span>
              <span class="data-stat-value" id="data-atk-in-debuff">—</span>
            </div>
          </div>
          <div id="data-atk-now"></div>
        </div>`,
  )
}

/** Fill the ⚔️ Attacks section, or hide it while attacks are not in play. */
function updateAttacks(state: Readonly<GameState>, modeDef: ModeDefinition): void {
  if (!document.getElementById('data-attacks')) return
  const player = state.player
  const own = isPanelUnlocked(player, modeDef, attackPanel.id)
  const inPlay = own || isAttackedNow(state)
  setSectionShown('data-attacks', inPlay)
  if (!inPlay) return

  const flavor = getModeFlavor(modeDef)
  setHidden('data-atk-slots', !own)
  const rows = own ? renderAttackRows(state, modeDef, flavor) : ''
  setHidden('data-atk-own', rows === '')
  setListHtml('data-atk-list', rows)
  if (own) {
    for (const kind of ATTACK_KINDS.filter((k) => isAttackKindCapped(modeDef, k))) {
      setText(
        `data-atk-slots-${kind}`,
        `${attackSlotsHeld(player, modeDef, kind)} / ${attackLimit(player, modeDef, kind)}`,
      )
    }
  }

  const incoming = roundStats.incomingAttacks
  setText('data-atk-in-strikes', formatNumber(readAttacksSuffered(player)))
  setText('data-atk-in-gens', formatNumber(sumCounts(incoming.generators)))
  for (const r of modeDef.resources) {
    setText(`data-atk-in-lost-${r}`, formatNumber(incoming.resources[r] ?? 0))
  }
  setText('data-atk-in-debuff', formatSec(roundStats.incomingDebuffSec(readGameSec(player))))
  setListHtml('data-atk-now', renderIncomingNow(state, modeDef, flavor))
}

/**
 * A pact's status: a passive treaty is simply in force; an active one shows
 * its timed phase when it is in one (the card's countdown), otherwise whether
 * it can be paid for.
 */
function pactStatus(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  pact: PactDefinition,
): string {
  if (pact.kind === 'passive') return 'In force'
  const life = pactLifecycle(state.player, pact.id)
  if (life) return countdownSpan(life, readGameSec(state.player))
  return readinessLabel(pactBlockReason(state.player, pact.id, modeDef))
}

/**
 * What an active pact's windows have come to this round. The window open in
 * the (reconciled) state rides along as `predicted`, so an activation counts
 * the moment the card says "Active", before the server's snapshot confirms it.
 */
function pactTallyLine(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
  pact: PactDefinition,
): string {
  const open = openPactWindows(state.player, readGameSec(state.player)).find(
    (w) => w.pact === pact.id,
  )
  const predicted = open
    ? { startSec: pactWindowOpenedAtSec(open, modeDef), endSec: open.expiresAtSec }
    : null
  const activations = roundStats.pactActivations(pact.id, predicted)
  if (activations === 0) return 'Not activated yet'
  const spent: Record<string, number> = {}
  for (const [res, amt] of Object.entries(getPactActivationCost(pact))) {
    spent[res] = amt * activations
  }
  const parts = [
    `${activations} activation${activations === 1 ? '' : 's'}`,
    `${formatSec(roundStats.pactActiveSec(pact.id, readGameSec(state.player), predicted))} active`,
  ]
  const cost = formatCostSum(spent, flavor)
  if (cost !== '') parts.push(`spent ${cost}`)
  return parts.join(' · ')
}

/** One row per pact this player holds, active first. */
function renderPactRows(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
): string {
  const held = new Set(unlockedPacts(state.player, modeDef))
  const defs = modeDef.pacts.filter((p) => held.has(p.id))
  const bonusById = new Map(state.pactBonuses.map((b) => [b.pact, b]))
  return [...defs.filter((p) => p.kind === 'active'), ...defs.filter((p) => p.kind === 'passive')]
    .map((pact) => {
      const worth = [
        ...(bonusById.get(pact.id)?.modifiers ?? []).map((m) => pactWorthText(m, modeDef, flavor)),
        ...pactDiscountTexts(state, pact.id),
      ]
      const details: string[] = []
      if (worth.length > 0) details.push(worth.join(' · '))
      else if (pact.kind === 'passive' && (pact.effects?.length ?? 0) > 0)
        details.push('no bonus yet')
      if (pact.kind === 'active') details.push(pactTallyLine(state, modeDef, flavor, pact))
      const mutual = pact.mutual ? ' 🤝' : ''
      return renderItem(
        `${getPactIcon(flavor, pact.id)} ${getPactName(flavor, pact.id)}${mutual}`,
        pactStatus(state, modeDef, pact),
        details,
      )
    })
    .join('')
}

/**
 * The enemy treaties that have reached this player this round. The snapshot's
 * own list is merged in so the panel never depends on `game.ts` having
 * recorded it first.
 */
function sharedPactIds(state: Readonly<GameState>): string[] {
  return [...new Set([...roundStats.sharedPactsSeen, ...state.opponentPacts])]
}

/**
 * One row per enemy treaty that has reached this player this round: its
 * window's countdown, in force (a mutual pact), or ended (a window that closed).
 */
function renderSharedPactRows(
  state: Readonly<GameState>,
  flavor: ModeFlavor,
  reached: readonly string[],
): string {
  const gameSec = readGameSec(state.player)
  return reached
    .map((id) => {
      const window = state.opponentPactWindows.find((w) => w.pact === id)
      const status = window
        ? countdownSpan({ template: 'Active for {}s', untilSec: window.expiresAtSec }, gameSec)
        : state.opponentPacts.includes(id)
          ? 'In force'
          : 'Ended'
      return renderItem(`${getPactIcon(flavor, id)} ${getPactName(flavor, id)}`, status, [])
    })
    .join('')
}

/** The 🤝 Pacts section skeleton (filled by {@link updatePacts}); empty for a mode without pacts. */
function renderPactsSection(modeDef: ModeDefinition): string {
  if (modeDef.pacts.length === 0) return ''
  const capped = PACT_KINDS.filter((k) => isPactKindCapped(modeDef, k))
  return renderSection(
    'pacts',
    '🤝 Pacts',
    `
        <div id="data-pacts">
          ${renderSlotCells('data-pact-slots', 'pact', capped)}
          <div id="data-pact-own">
            <p class="data-subhead">Yours</p>
            <div class="data-item-list" id="data-pact-list"></div>
          </div>
          <div id="data-pact-shared">
            <p class="data-subhead">From the enemy</p>
            <div class="data-item-list" id="data-pact-shared-list"></div>
            <div class="data-stat-grid">
              <div class="data-stat">
                <span class="data-stat-label">Auto-clicks received</span>
                <span class="data-stat-value" id="data-pact-autoclicks">—</span>
              </div>
            </div>
          </div>
        </div>`,
  )
}

/** Fill the 🤝 Pacts section, or hide it while pacts are not in play. */
function updatePacts(state: Readonly<GameState>, modeDef: ModeDefinition): void {
  if (!document.getElementById('data-pacts')) return
  const player = state.player
  const own = isPanelUnlocked(player, modeDef, internationalRelationshipPanel.id)
  const reached = sharedPactIds(state)
  const inPlay = own || reached.length > 0
  setSectionShown('data-pacts', inPlay)
  if (!inPlay) return

  const flavor = getModeFlavor(modeDef)
  setHidden('data-pact-slots', !own)
  const rows = own ? renderPactRows(state, modeDef, flavor) : ''
  setHidden('data-pact-own', rows === '')
  setListHtml('data-pact-list', rows)
  if (own) {
    for (const kind of PACT_KINDS.filter((k) => isPactKindCapped(modeDef, k))) {
      setText(
        `data-pact-slots-${kind}`,
        `${pactSlotsHeld(player, modeDef, kind)} / ${pactLimit(player, modeDef, kind)}`,
      )
    }
  }

  setHidden('data-pact-shared', reached.length === 0)
  setListHtml('data-pact-shared-list', renderSharedPactRows(state, flavor, reached))
  setText('data-pact-autoclicks', `+${formatDecimal(state.incomingAutoClicksPerSec, 1)}/s`)
}

/** One resource's production + source-breakdown section (stable IDs, filled by update()). */
function renderResourceSection(
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
  resource: string,
): string {
  const icon = getResourceIcon(flavor, resource)
  const name = getResourceName(flavor, resource)

  const body = `
      <div class="data-breakdown">
        <div class="data-bar" role="img" aria-label="Production sources for ${name}">
          <span class="data-bar-seg data-bar-base" id="data-bar-base-${resource}"></span>
          <span class="data-bar-seg data-bar-gen" id="data-bar-gen-${resource}"></span>
        </div>
        <div class="data-source-row">
          <span class="data-source-label"><i class="data-swatch data-swatch-base"></i> Base</span>
          <span id="data-src-base-${resource}">—</span>
        </div>
        ${renderGeneratorRow(modeDef, flavor, resource)}
      </div>`

  // The rate rides in the header, so a collapsed section still shows the total.
  return renderSection(
    `prod:${resource}`,
    `${icon} ${name} production`,
    body,
    `<span class="data-resource-rate" id="data-total-rate-${resource}">—</span>`,
  )
}

/** Build the full panel skeleton once (numbers filled by update()). */
function renderSkeleton(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
  showScore: boolean,
): string {
  const production = modeDef.resources
    .map((r) => renderResourceSection(modeDef, flavor, r))
    .join('')

  // Rows are filled here too (not just by update()) so a tab switch mid-round
  // paints the current bonuses immediately.
  const bonuses = renderSection(
    'bonuses',
    '🔀 Live bonuses',
    `<div class="data-bonus-list" id="data-bonus-list">${renderBonusRows(state, modeDef, flavor)}</div>`,
  )

  const inventoryRows = modeDef.resources
    .map(
      (r) => `
        <div class="data-stat">
          <span class="data-stat-label">${getResourceIcon(flavor, r)} ${getResourceName(flavor, r)}</span>
          <span class="data-stat-value" id="data-inv-${r}">—</span>
        </div>`,
    )
    .join('')

  const earnedByResource = modeDef.resources
    .map(
      (r) => `
          <div class="data-stat">
            <span class="data-stat-label">${getResourceIcon(flavor, r)} ${getResourceName(flavor, r)} clicked</span>
            <span class="data-stat-value" id="data-click-earned-${r}">—</span>
          </div>`,
    )
    .join('')

  const clicking = modeDef.clicksEnabled
    ? renderSection(
        'clicking',
        '🖱️ Clicking',
        `
        <div class="data-stat-grid">
          <div class="data-stat">
            <span class="data-stat-label">Per click</span>
            <span class="data-stat-value" id="data-click-income">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Peak CPS</span>
            <span class="data-stat-value" id="data-click-peak">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Average CPS</span>
            <span class="data-stat-value" id="data-click-avg">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Total clicks</span>
            <span class="data-stat-value" id="data-click-total">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Earned by clicking</span>
            <span class="data-stat-value" id="data-click-earned">—</span>
          </div>
          ${earnedByResource}
        </div>`,
      )
    : ''

  const dwellRows = [
    ...modeDef.resources.map(
      (r) => `
          <div class="data-stat">
            <span class="data-stat-label">${getResourceIcon(flavor, r)} ${getResourceName(flavor, r)}</span>
            <span class="data-stat-value" id="data-hl-dwell-${r}">—</span>
          </div>`,
    ),
    // Released time closes the round out: the resource rows plus this one account
    // for the whole clock.
    `
          <div class="data-stat">
            <span class="data-stat-label">🚫 Released</span>
            <span class="data-stat-value" id="data-hl-released">—</span>
          </div>`,
  ].join('')

  // Battery rows live under Highlight rather than in a section of their own: it's
  // one mechanic, and the multiplier above already includes the battery's share.
  // The whole block is `hidden` until the lantern is bought — `update` unhides it,
  // since the skeleton is rendered once per round while the gate can flip mid-round.
  const battery = `
        <div id="data-battery" hidden>
          <p class="data-subhead">🪔 Lantern</p>
          <div class="data-stat-grid">
            <div class="data-stat">
              <span class="data-stat-label">Charge</span>
              <span class="data-stat-value" id="data-bat-charge">—</span>
            </div>
            <div class="data-stat">
              <span class="data-stat-label">Its multiplier</span>
              <span class="data-stat-value" id="data-bat-factor">—</span>
            </div>
            <div class="data-stat">
              <span class="data-stat-label">Net</span>
              <span class="data-stat-value" id="data-bat-net">—</span>
            </div>
            <div class="data-stat">
              <span class="data-stat-label" id="data-bat-eta-label">Runs dry in</span>
              <span class="data-stat-value" id="data-bat-eta">—</span>
            </div>
          </div>
        </div>`

  const highlight = modeDef.highlightEnabled
    ? renderSection(
        'highlight',
        '✨ Highlight',
        `
        <div class="data-stat-grid">
          <div class="data-stat">
            <span class="data-stat-label">Current</span>
            <span class="data-stat-value" id="data-hl-current">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Multiplier</span>
            <span class="data-stat-value" id="data-hl-mult">—</span>
          </div>
        </div>
        ${battery}
        <p class="data-subhead">Time highlighted</p>
        <div class="data-stat-grid">${dwellRows}</div>`,
      )
    : ''

  const inventory = renderSection(
    'inventory',
    '📦 Inventory',
    `
        <div class="data-stat-grid">
          ${inventoryRows}
          ${
            showScore
              ? `<div class="data-stat">
            <span class="data-stat-label">🏆 Score</span>
            <span class="data-stat-value" id="data-inv-score">—</span>
          </div>`
              : ''
          }
          <div class="data-stat">
            <span class="data-stat-label">🏭 Generators</span>
            <span class="data-stat-value" id="data-inv-generators">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">⬆️ Upgrades</span>
            <span class="data-stat-value" id="data-inv-upgrades">—</span>
          </div>
        </div>`,
  )

  return `
    <div class="data-panel" id="data-panel">
      ${production}
      ${bonuses}
      ${clicking}
      ${highlight}
      ${renderAttacksSection(modeDef, flavor)}
      ${renderPactsSection(modeDef)}
      ${inventory}
    </div>
  `
}

/** Push live numbers into the skeleton via setText / style updates. */
function updateNumbers(state: Readonly<GameState>): void {
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)

  // Incoming debuffs, resolved once against this player — every figure below that
  // folds them in reads from here (see `resolveEnemyDebuffs`). The pact bonuses
  // in force ride beside them into every total, but not into the
  // before/after pairs, which report what the enemy is *taking*.
  const debuffs = resolveEnemyDebuffs(state.debuffs, state.player, modeDef)
  const bonuses = resolveEnemyDebuffs(pactModifiers(state.pactBonuses), state.player, modeDef)

  // Production + source breakdown (debuffs and bonuses folded in so totals match the header).
  const breakdown = computeRateBreakdown(state.player, modeDef, [...debuffs, ...bonuses])
  const outputs = collectGeneratorOutputs(state.player, modeDef)
  for (const r of modeDef.resources) {
    const bd: ResourceRateBreakdown = breakdown[r]
    setText(`data-total-rate-${r}`, formatRate(bd.total))
    setText(`data-src-base-${r}`, formatAmount(bd.base))
    setText(`data-src-gen-${r}`, formatAmount(bd.generators))

    const total = bd.base + bd.generators
    setBarWidth(`data-bar-base-${r}`, share(bd.base, total))
    setBarWidth(`data-bar-gen-${r}`, share(bd.generators, total))

    for (const g of generatorsFor(modeDef, r)) {
      const rate = bd.byGenerator[g.id] ?? 0
      const owned = state.player.generators[g.id] ?? 0
      const row = document.getElementById(`data-gen-row-${r}-${g.id}`)
      if (row) row.style.display = owned > 0 ? '' : 'none'
      setText(`data-gen-rate-${r}-${g.id}`, `${formatRate(rate)} ×${owned}`)
      setText(`data-gen-detail-${r}-${g.id}`, generatorDetail(outputs[g.id], rate))
    }
  }

  // Live bonuses. The whole list is re-rendered when it changes, and the section
  // hides itself while nothing dynamic is active (early round, none owned).
  const bonusRows = renderBonusRows(state, modeDef, getModeFlavor(modeDef))
  setListHtml('data-bonus-list', bonusRows)
  setSectionShown('data-bonus-list', bonusRows !== '')

  // Clicking (per-click income folds in debuffs, matching the credit applied on click).
  if (modeDef.clicksEnabled) {
    const ownModifiers = collectModifiers(state.player, modeDef)
    // The un-debuffed figure keeps the pact bonuses in: they are this player's
    // to enjoy, so the before/after pair below isolates what the enemy takes.
    const baseClick = computeClickIncome([...ownModifiers, ...bonuses])
    const clickIncome = computeClickIncome([...ownModifiers, ...debuffs, ...bonuses])
    const fmt = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 1)
    const clickEl = document.getElementById('data-click-income')
    if (clickEl) {
      // While an enemy debuff is dragging the figure below its un-debuffed
      // worth, show the debuffed value in red with the base value alongside in
      // parentheses; otherwise just the plain figure.
      if (clickIncome !== baseClick) {
        clickEl.innerHTML = `<span class="data-value-debuffed">${fmt(clickIncome)}</span> <span class="data-value-base">(${fmt(baseClick)})</span>`
      } else {
        clickEl.textContent = fmt(clickIncome)
      }
    }
    setText('data-click-peak', formatNumber(roundStats.peakCps, 1))
    setText('data-click-avg', formatNumber(roundStats.averageCps(state.player), 1))
    setText('data-click-total', formatNumber(roundStats.totalClicks))
    setText('data-click-earned', formatNumber(roundStats.totalIncome))
    for (const r of modeDef.resources) {
      setText(`data-click-earned-${r}`, formatNumber(roundStats.incomeByResource[r] ?? 0))
    }
  }

  // Highlight
  if (modeDef.highlightEnabled) {
    const flavor = getModeFlavor(modeDef)
    const current = readHighlight(state.player)
    setText(
      'data-hl-current',
      current === null
        ? 'Released'
        : `${getResourceIcon(flavor, current)} ${getResourceName(flavor, current)}`,
    )
    // The multiplier reads *debuffed* while a resource is held: incoming
    // highlight debuffs scale its bonus (see `debuffedHighlightFactor`), so it
    // matches the production it buys. When a debuff drags it below its
    // un-debuffed worth, show the debuffed value in red with the base alongside
    // in parentheses — the same before/after the clicking section uses. Released,
    // the factor lands nowhere and `getHighlightMultiplier` reports a neutral ×1.
    const factor = getHighlightMultiplier(state.player, modeDef)
    const held = current !== null
    const mult = held ? debuffedHighlightFactor(factor, state.debuffs) : factor
    const multEl = document.getElementById('data-hl-mult')
    if (multEl) {
      if (held && mult !== factor) {
        multEl.innerHTML = `<span class="data-value-debuffed">×${formatMultiplier(mult)}</span> <span class="data-value-base">(×${formatMultiplier(factor)})</span>`
      } else {
        multEl.textContent = `×${formatMultiplier(mult)}`
      }
    }
    updateBattery(state, modeDef)
    for (const r of modeDef.resources) {
      setText(`data-hl-dwell-${r}`, `${formatNumber(roundStats.dwellByResource[r] ?? 0, 1)}s`)
    }
    setText('data-hl-released', `${formatNumber(roundStats.releasedSec, 1)}s`)
  }

  // Inventory
  for (const r of modeDef.resources) {
    setText(`data-inv-${r}`, formatNumber(state.player.resources[r] ?? 0))
  }
  setText('data-inv-score', formatNumber(state.player.score))
  setText('data-inv-generators', formatNumber(sumCounts(state.player.generators)))
  setText('data-inv-upgrades', formatNumber(sumCounts(state.player.upgrades)))

  updateAttacks(state, modeDef)
  updatePacts(state, modeDef)
}

/**
 * Fill the lantern rows, or hide the block while the lantern is locked (the
 * skeleton is rendered once per round, but the gate can flip mid-round).
 *
 * Reads the authoritative charge rather than the play panel's animated
 * prediction: this is the diagnostics panel, so it should agree with the server
 * even if that means stepping once per snapshot.
 */
function updateBattery(state: Readonly<GameState>, modeDef: ModeDefinition): void {
  const block = document.getElementById('data-battery')
  if (!block) return
  const charge = readBatteryCharge(state.player)
  const active = charge !== null && isHighlightBatteryActive(state.player, modeDef)
  block.hidden = !active
  if (charge === null || !active) return

  const params = collectBatteryParams(state.player, modeDef)
  const held = readHighlight(state.player) !== null
  setText('data-bat-charge', `${formatQuantity(charge)} / ${formatQuantity(params.maxCharge)}`)
  // The battery's own share, not the combined highlight multiplier above.
  setText('data-bat-factor', `×${formatMultiplier(batteryFactor(state.player, modeDef))}`)
  const net = held ? -params.drainRate : params.chargeRate
  setText('data-bat-net', `${net < 0 ? '-' : '+'}${formatQuantity(Math.abs(net))}/s`)

  // Which direction it's heading is the number a player plans against.
  const rate = held ? params.drainRate : params.chargeRate
  const remaining = held ? charge : params.maxCharge - charge
  setText('data-bat-eta-label', held ? 'Runs dry in' : 'Full in')
  setText(
    'data-bat-eta',
    rate <= 0 || remaining <= 0 ? '—' : `${formatNumber(Math.ceil(remaining / rate))}s`,
  )
}

/** Set a breakdown-bar segment's width as a percentage. */
function setBarWidth(id: string, pct: number): void {
  const el = document.getElementById(id)
  if (el) el.style.width = `${pct}%`
}

/** Sum the values of a count map (generators owned, upgrades owned). */
function sumCounts(counts: Readonly<Record<string, number>>): number {
  let total = 0
  for (const n of Object.values(counts)) total += n
  return total
}

// ─── Panel ───────────────────────────────────────────────────────────

export const dataPanel: Panel = {
  id: 'data',
  label: 'Data',
  icon: '📊',

  render(container, state) {
    if (!state.mode) {
      container.innerHTML = ''
      return
    }
    const modeDef = getModeDefinition(state.mode)
    // Race-to-buy hides scores entirely (the opponent's is never revealed), so
    // the score stat is meaningless there — omit it.
    const showScore = state.goal?.type !== 'buy-upgrade'
    listHtml.clear()
    container.innerHTML = renderSkeleton(state, modeDef, getModeFlavor(modeDef), showScore)
    updateNumbers(state)
  },

  bind() {
    // One delegated listener on the (freshly rendered) panel root covers every
    // section header and generator-list toggle.
    document.getElementById('data-panel')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-collapse]')
      if (btn) toggleCollapse(btn)
    })
  },

  update(state) {
    updateNumbers(state)
  },
}
