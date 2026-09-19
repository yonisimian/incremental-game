/**
 * Reusable effects editor — renders the add/remove/edit UI for a list of effect
 * refs, with each effect's form generated from its registered zod param schema.
 * Shared by the upgrade-node inspector and the attacks view, so both author
 * effects identically. The host owns *where* the effects live (a tree node's
 * `effects`, an attack's `effects`, …) via `getEffects`/`setEffects`; this module
 * owns the form rendering and validation.
 */

import {
  addressableSourcesFor,
  addressableTargetsFor,
  ATTACK_STATS,
  attackStatOpsFor,
  attackStatsFor,
  enemyCostTargetsFor,
  enemyDataKeysFor,
  enemyDebuffTargetsFor,
  NON_RESOURCE_INTEL_KEYS,
  isEffectAllowedOn,
  isTimeEffectType,
  listEffectTypes,
  resolveEffect,
  UNLOCKABLE_SYSTEMS,
  type AttackStat,
  type AttackStatOp,
  type EffectHost,
  type TreeFile,
} from '@game/shared'

import {
  defaultParamsForEffect,
  describeEffectSchema,
  matchVariant,
  type EffectFormSpec,
  type FieldSpec,
  type VariantSpec,
} from './effect-schema.js'
import { describeEffectRef } from './effect-preview.js'
import { collectIds } from './model.js'
import { ALL_PANELS } from '../../ui/mode-ui.js'
import { el } from './views/dom.js'

/** A single effect ref: a `type` discriminant plus inline params. */
interface EffectEntry {
  readonly type: string
  readonly [param: string]: unknown
}

/**
 * Where the edited effects live. The editor reads via `getEffects` and persists
 * via `setEffects`, which the host implements to write the new array back and
 * mark the document dirty (and re-render anything derived from it).
 */
export interface EffectsHost {
  readonly tree: TreeFile
  /**
   * Which host these effects live on. The "+ effect" picker offers only the
   * effects legal there, so an effect no consumer would ever read — a steal on
   * an upgrade, a production bonus on an attack — can't be authored in the first
   * place (`validateModeDefinition` rejects it at load either way).
   */
  readonly effectHost: EffectHost
  getEffects(): readonly EffectEntry[]
  setEffects(next: EffectEntry[]): void
}

/** zod's `safeParse` is all this module needs from a resolved effect schema. */
interface ScalarSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues: { message: string }[] } }
}

function paramsOf(ref: EffectEntry): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ref).filter(([key]) => key !== 'type'))
}

/** A label + control row, matching the inspector's effect-field layout. */
function field(label: string, control: HTMLElement): HTMLDivElement {
  const row = el('div', 'ed-field')
  row.append(el('label', 'ed-field-label', label), control)
  return row
}

/**
 * One picker option: a bare key (label = key) or an explicit value/label pair
 * (so catalog-driven fields can show a human description while storing the key).
 */
export type EffectFieldOption = string | { readonly value: string; readonly label: string }

/**
 * Fixed option set for an effect's string param, or `undefined` to render a free
 * text input. The effect schema (`z.string()`) carries no enum, so id-referencing
 * fields are mapped here — a UI-only concern: `generatorCost`'s `generator` picks
 * from the tree's generators, `panelUnlock`'s `panel` from the known panels, and
 * `unlockAttack`'s and `attackStat`'s `attack` from the tree's attacks, and
 * `accessEnemyData`'s `data` from the tree's resource keys (stockpile) plus a
 * `:rate` variant per resource (per-second production) and the non-resource
 * intel keys (peak CPS, purchases), `stealResource`'s `resource` from the
 * tree's resource keys, and `stealGenerator`'s `generator` from its generators.
 * `relativeModifier`'s `field`/`source` come from the
 * shared addressable-field catalog (labelled), the same set the
 * boot-time validator enforces; `enemyProductionModifier`'s `field` uses the
 * narrower enemy-debuff catalog (resource rates plus click income and highlight
 * factor — generator targets don't apply to a debuff); `enemyCostModifier`'s
 * `target` uses the enemy-cost catalog (a whole scope, or one upgrade /
 * generator by namespaced key); and every time-clock effect's `clock` picks from
 * the tree's own node ids.
 *
 * A few option sets depend on a *sibling* param, which is what `params` (the
 * ref's current params, minus `type`) is for: `attackStat`'s `stat` drops
 * `prepareCost`/`prepareTime` once `attack` names a passive attack, since a
 * passive attack is never activated and has neither. See
 * {@link OPTION_SOURCE_FIELDS} for how the form re-resolves after such an edit.
 *
 * Exported for testing: every id-referencing param should resolve to a picker,
 * so free text can never author a key the boot-time validator would reject.
 */
export function effectFieldOptions(
  tree: TreeFile,
  effectType: string,
  fieldKey: string,
  params?: Readonly<Record<string, unknown>>,
): readonly EffectFieldOption[] | undefined {
  if (effectType === 'attackStat' && fieldKey === 'op') {
    // Which ops the chosen stat accepts (the schema rejects the rest at load),
    // labelled so the *relative* ops can't be misread as the stat's own unit —
    // `add: 5` on prepareTime is a ×6 multiplier, not five seconds.
    return attackStatOpsFor(attackStatOf(params)).map((op) => ({
      value: op,
      label: ATTACK_STAT_OP_LABELS[op],
    }))
  }
  if (effectType === 'batteryStat' && fieldKey === 'op') {
    // The battery's `add` *is* in the stat's own unit (it shifts
    // `BATTERY_DEFAULTS`), so it needs no qualifier — only `mult` is spelled out.
    return [
      { value: 'add', label: 'add' },
      { value: 'mult', label: 'multiply' },
    ]
  }
  if (effectType === 'attackStat' && fieldKey === 'stat') {
    // The attack's own kind decides which stats mean anything on it; an
    // `attack`-less ref buffs every attack, so it keeps the full list.
    const target = params?.attack
    const attack =
      typeof target === 'string' ? tree.attacks.find((a) => a.id === target) : undefined
    return [...attackStatsFor(attack?.kind ?? 'active')]
  }
  if (effectType === 'relativeModifier' && fieldKey === 'source') {
    return addressableSourcesFor(tree.resources).map((f) => ({ value: f.key, label: f.label }))
  }
  if (effectType === 'relativeModifier' && fieldKey === 'field') {
    return addressableTargetsFor(
      tree.resources,
      tree.generators.map((g) => g.id),
    ).map((f) => ({ value: f.key, label: f.label }))
  }
  if (effectType === 'enemyProductionModifier' && fieldKey === 'field') {
    return enemyDebuffTargetsFor(tree.resources).map((f) => ({ value: f.key, label: f.label }))
  }
  if (effectType === 'enemyCostModifier' && fieldKey === 'target') {
    return enemyCostTargetsFor(
      collectIds(tree),
      tree.generators.map((g) => g.id),
    ).map((f) => ({ value: f.key, label: f.label }))
  }
  if (
    (effectType === 'generatorCost' || effectType === 'generatorUnlock') &&
    fieldKey === 'generator'
  ) {
    return tree.generators.map((g) => g.id)
  }
  if (effectType === 'panelUnlock' && fieldKey === 'panel') {
    return ALL_PANELS.map((p) => p.id)
  }
  if (effectType === 'systemUnlock' && fieldKey === 'system') {
    return [...UNLOCKABLE_SYSTEMS]
  }
  if (effectType === 'accessEnemyData' && fieldKey === 'data') {
    return [...tree.resources.flatMap((key) => enemyDataKeysFor(key)), ...NON_RESOURCE_INTEL_KEYS]
  }
  if ((effectType === 'unlockAttack' || effectType === 'attackStat') && fieldKey === 'attack') {
    return tree.attacks.map((a) => a.id)
  }
  if (effectType === 'stealResource' && fieldKey === 'resource') {
    return tree.resources
  }
  if (effectType === 'stealGenerator' && fieldKey === 'generator') {
    return tree.generators.map((g) => g.id)
  }
  if (effectType === 'unlockPact' && fieldKey === 'pact') {
    return tree.pacts.map((p) => p.id)
  }
  // Every time-clock effect names the upgrade whose purchase starts the clock, so
  // the picker is the tree's own node ids — the same set `validateModeDefinition`
  // checks the ref against.
  if (isTimeEffectType(effectType) && fieldKey === 'clock') {
    return collectIds(tree)
  }
  // `baseModifier` and the time clock's payout target the same production catalog
  // the boot-time validator enforces: each resource's global rate (`rK`) and
  // isolated base producer (`bK`), each generator, plus the `clickIncome` special.
  if (
    (effectType === 'baseModifier' || effectType === 'timeScaledModifier') &&
    fieldKey === 'field'
  ) {
    return addressableTargetsFor(
      tree.resources,
      tree.generators.map((g) => g.id),
    ).map((f) => ({ value: f.key, label: f.label }))
  }
  return undefined
}

/** How each `attackStat` operator is titled in the form. */
const ATTACK_STAT_OP_LABELS: Readonly<Record<AttackStatOp, string>> = {
  add: '+ to multiplier',
  mult: '× multiplier',
  offset: 'offset (seconds)',
}

/** The `attackStat` stat a ref's params name, defaulting to the first one. */
function attackStatOf(params?: Readonly<Record<string, unknown>>): AttackStat {
  const stat = params?.stat
  const known: readonly string[] = ATTACK_STATS
  return typeof stat === 'string' && known.includes(stat) ? (stat as AttackStat) : ATTACK_STATS[0]
}

/**
 * Per effect type, the params whose value *narrows another param's* option set —
 * so editing one must re-resolve the rest of the block.
 *
 * `attackStat` is the only case today: once `attack` names a passive attack, the
 * stats an active attack alone can use (`prepareCost`, `prepareTime`) leave the
 * `stat` picker, and a stat already selected has to go with them — otherwise the
 * form would keep writing a combination `validateModeDefinition` refuses to boot
 * on, which the author only discovers as a startup error.
 */
const OPTION_SOURCE_FIELDS: Record<string, readonly string[]> = {
  // A chain, resolved in schema order: `attack` narrows `stat` (a passive attack
  // has no prepare cost or delay), and `stat` in turn narrows `op` (only
  // `prepareTime` has a unit an `offset` can shift). `repairOptionValues` walks
  // the fields in that same order, so one edit can cascade through both.
  attackStat: ['attack', 'stat'],
}

/** The stored value of a picker option. */
function optionValue(option: EffectFieldOption): string {
  return typeof option === 'string' ? option : option.value
}

/**
 * Display names for param keys whose schema spelling reads worse than the thing
 * it names. Presentation only — the stored key is untouched.
 */
const FIELD_LABELS: Record<string, string> = {
  op: 'operator',
}

/** How a param is titled in the form. */
function fieldLabel(spec: FieldSpec): string {
  const name = FIELD_LABELS[spec.key] ?? spec.key
  return spec.optional ? `${name} (optional)` : name
}

/**
 * Re-resolve every option-bearing field of `values` and snap any value the
 * narrowed options no longer offer to the first one they do.
 *
 * Only called after an {@link OPTION_SOURCE_FIELDS} edit, so it can't touch the
 * "unrecognized value preserved as its own option" path that a since-removed id
 * relies on during ordinary editing.
 */
function repairOptionValues(
  tree: TreeFile,
  effectType: string,
  variant: VariantSpec,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...values }
  for (const spec of variant.fields) {
    if (spec.kind !== 'string') continue
    const options = effectFieldOptions(tree, effectType, spec.key, next)
    if (!options || options.length === 0) continue
    const current = next[spec.key]
    if (typeof current !== 'string') continue
    if (!options.some((option) => optionValue(option) === current)) {
      next[spec.key] = optionValue(options[0])
    }
  }
  return next
}

/**
 * Mirror a `value` an option repair has just invalidated.
 *
 * Snapping a picker can change what the block's number *means*: `attackStat`'s
 * legal range follows the stat, so re-pointing a ×0.5 discount at `power` — a
 * stat that may only grow — leaves a number the schema rejects, and the edit
 * would silently fail to save. Every op has an exact opposite (`mult` inverts,
 * `add` and `offset` negate), so the mirrored value is the same-sized change the
 * other way: ×0.5 becomes ×2, -1s becomes +1s.
 *
 * Only reached after an {@link OPTION_SOURCE_FIELDS} edit, and only when the
 * block no longer parses — an authored number is never rewritten while it is
 * still legal. If the mirror does not parse either (a `0`, whose opposite is
 * itself), the value stands and the error line says why.
 */
function repairGuardedValue(
  schema: ScalarSchema,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (schema.safeParse(values).success) return values
  const value = values.value
  if (typeof value !== 'number' || value === 0) return values
  const mirrored = { ...values, value: values.op === 'mult' ? 1 / value : -value }
  return schema.safeParse(mirrored).success ? mirrored : values
}

function buildEffectField(
  spec: FieldSpec,
  current: unknown,
  onChange: () => void,
  options?: readonly EffectFieldOption[],
): { row: HTMLElement; read: () => unknown } {
  const label = fieldLabel(spec)
  if (spec.kind === 'boolean') {
    const input = el('input', 'ed-input ed-effect-check')
    input.type = 'checkbox'
    input.checked = current === true || (current === undefined && spec.defaultValue === true)
    input.addEventListener('change', onChange)
    return { row: field(label, input), read: () => input.checked }
  }
  // A string field with a fixed option set renders as a picker: host-supplied
  // options (e.g. the `generatorCost` effect's `generator`) or the field's own
  // enum members (e.g. the `baseModifier` effect's `stage`). Options are either
  // bare keys or value/label pairs (e.g. `relativeModifier`'s catalog-driven
  // source/field, which show a description but store the key). An unrecognized
  // current value (a since-removed id) is preserved as its own option rather
  // than silently lost.
  const rawOptions = options ?? spec.options
  if (spec.kind === 'string' && rawOptions) {
    const selectOptions = rawOptions.map((o) =>
      typeof o === 'string' ? { value: o, label: o } : o,
    )
    // An *optional* picker needs a way back to "unset" — for `attackStat`'s
    // `attack` that's the "every attack" authoring, and without a blank entry the
    // browser would pre-select the first id and the next edit to any sibling
    // field would silently persist it.
    if (spec.optional) selectOptions.unshift({ value: '', label: '(unset)' })
    const select = el('select', 'ed-input')
    const value = typeof current === 'string' ? current : ''
    if (value !== '' && !selectOptions.some((o) => o.value === value)) {
      const opt = el('option', undefined, `${value} (unknown)`)
      opt.value = value
      select.append(opt)
    }
    for (const { value: optValue, label: optLabel } of selectOptions) {
      const opt = el('option', undefined, optLabel)
      opt.value = optValue
      select.append(opt)
    }
    // Select by assigning the *select's* value once every option is in place,
    // rather than flagging an option as `selected` before insertion — browsers
    // honor a pre-insertion flag, happy-dom does not, and this says what it means
    // either way. An absent value leaves the browser's own default (the first
    // option), exactly as before.
    if (value !== '') select.value = value
    select.addEventListener('change', onChange)
    return {
      row: field(label, select),
      read: () => (select.value === '' ? undefined : select.value),
    }
  }
  const input = el('input', 'ed-input')
  input.type = spec.kind === 'number' ? 'number' : 'text'
  const initial = current ?? spec.defaultValue
  if (typeof initial === 'number' || typeof initial === 'string' || typeof initial === 'boolean') {
    input.value = String(initial)
  }
  input.addEventListener('change', onChange)
  const read = (): unknown => {
    const raw = input.value.trim()
    if (raw === '') return undefined
    return spec.kind === 'number' ? Number(raw) : raw
  }
  return { row: field(label, input), read }
}

function buildEffectBlock(
  host: EffectsHost,
  ref: EffectEntry,
  index: number,
  rerender: () => void,
): HTMLElement {
  const block = el('div', 'ed-effect')
  const header = el('div', 'ed-effect-header ed-row')
  header.append(el('strong', 'ed-effect-type', ref.type))
  const remove = el('button', 'ed-btn ed-btn-remove', '✕')
  remove.type = 'button'
  remove.addEventListener('click', () => {
    host.setEffects(host.getEffects().filter((_, j) => j !== index))
    rerender()
  })
  header.append(remove)
  block.append(header)

  const def = resolveEffect(ref.type)
  if (!def) {
    block.append(el('p', 'ed-hint', 'Unknown effect type — not editable.'))
    return block
  }
  let spec: EffectFormSpec
  try {
    spec = describeEffectSchema(def.schema)
  } catch {
    block.append(el('p', 'ed-hint', 'Effect schema not editable.'))
    return block
  }
  const schema: ScalarSchema = def.schema

  let params = paramsOf(ref)
  let variant = matchVariant(spec, params)
  const fieldsWrap = el('div', 'ed-fields')
  const error = el('p', 'ed-error')
  // What the authored params actually resolve to, for the refs whose numbers are
  // two abstractions from the outcome (see `describeEffectRef`). Empty for every
  // other effect, so the row simply collapses.
  const preview = el('p', 'ed-hint ed-effect-preview')

  const renderPreview = (values: Record<string, unknown>): void => {
    preview.textContent = describeEffectRef(host.tree, { type: ref.type, ...values }) ?? ''
  }

  /** Report (or clear) the schema's first complaint about `values`. */
  const showError = (values: Record<string, unknown>): boolean => {
    const result = schema.safeParse(values)
    error.textContent = result.success ? '' : (result.error?.issues[0]?.message ?? 'Invalid params')
    return result.success
  }

  const writeFrom = (values: Record<string, unknown>, silent = false): void => {
    renderPreview(values)
    if (!showError(values)) {
      if (silent) error.textContent = ''
      return
    }
    host.setEffects(
      host.getEffects().map((r, j) => (j === index ? { type: ref.type, ...values } : r)),
    )
  }

  const buildFields = (): void => {
    fieldsWrap.replaceChildren()
    const reads = new Map<string, () => unknown>()
    const collect = (): Record<string, unknown> => {
      const out: Record<string, unknown> = {}
      for (const [key, read] of reads) {
        const value = read()
        if (value !== undefined) out[key] = value
      }
      return out
    }
    const sources = OPTION_SOURCE_FIELDS[ref.type] ?? []
    for (const fieldSpec of variant.fields) {
      const { row, read } = buildEffectField(
        fieldSpec,
        params[fieldSpec.key],
        () => {
          // A field the block's *other* option sets depend on (`attackStat`'s
          // `attack`): re-resolve them and rebuild, so a choice the new options
          // no longer offer can't stay selected and reach the tree file.
          if (sources.includes(fieldSpec.key)) {
            params = repairGuardedValue(
              schema,
              repairOptionValues(host.tree, ref.type, variant, collect()),
            )
            writeFrom(params)
            buildFields()
            return
          }
          writeFrom(collect())
        },
        effectFieldOptions(host.tree, ref.type, fieldSpec.key, params),
      )
      reads.set(fieldSpec.key, read)
      fieldsWrap.append(row)
    }
  }
  buildFields()
  renderPreview(params)
  // Report what the block already holds, rather than waiting for an edit: a ref
  // the schema rejects — seeded by an older add button, hand-edited, or left
  // behind by a guard that has since tightened — is one the mode refuses to boot
  // on, and the author should meet it here rather than at startup.
  showError(params)

  if (spec.variants.length > 1) {
    const variantSelect = el('select', 'ed-input')
    for (const option of spec.variants) {
      const opt = el('option', undefined, option.label)
      opt.value = String(option.index)
      if (option.index === variant.index) opt.selected = true
      variantSelect.append(opt)
    }
    variantSelect.addEventListener('change', () => {
      const picked = spec.variants.find((v) => v.index === Number(variantSelect.value))
      if (!picked) return
      variant = picked
      // Seeded through the same candidate probe the add button uses, so
      // switching shape lands on params the variant's own guards accept.
      params = defaultParamsForEffect({ variants: [picked] }, (p) => schema.safeParse(p).success)
      buildFields()
      // Seeded defaults for a stricter variant (e.g. an empty required id) may
      // not parse yet; persist if valid but don't flash an error before the
      // user has touched the new fields.
      writeFrom(params, true)
    })
    block.append(field('Shape', variantSelect))
  }

  block.append(fieldsWrap, preview, error)
  return block
}

/** A picker group: a label and the effect types to list under it. */
export interface EffectGroup {
  readonly label: string
  readonly types: readonly string[]
}

/**
 * Display grouping for the "+ effect" picker — a UI-only authoring affordance.
 * The registry stays the source of *which* effects exist (`listEffectTypes`);
 * this table only decides how to *present* them. Any registered type not named
 * here falls into a trailing sorted "Other" group (see {@link groupEffectTypes}),
 * so a newly-registered effect is never silently hidden.
 */
export const EFFECT_GROUPS: readonly EffectGroup[] = [
  { label: 'Production', types: ['baseModifier', 'relativeModifier', 'enemyProductionModifier'] },
  { label: 'Highlight', types: ['highlightMultiplier', 'batteryStat', 'batteryBand'] },
  {
    label: 'Generators',
    types: [
      'generatorCost',
      'generatorUnlock',
      'lowerTierBoost',
      'dominantGenerator',
      'balancedGenerators',
    ],
  },
  {
    label: 'Unlocks',
    types: ['panelUnlock', 'systemUnlock', 'unlockAttack', 'unlockPact', 'accessEnemyData'],
  },
  {
    label: 'Offense',
    types: ['stealResource', 'stealGenerator', 'enemyCostModifier', 'attackStat', 'attackSlots'],
  },
  {
    label: 'Time clock',
    types: ['timeScaledModifier', 'timeFactorBoost', 'timeRetroactive'],
  },
]

/**
 * Partition `available` effect types into display groups by {@link EFFECT_GROUPS}
 * membership, preserving each group's declared order. Any type not named in a
 * group lands in a trailing sorted "Other" group. Empty groups are omitted, so
 * every input type appears exactly once across the result.
 */
export function groupEffectTypes(available: readonly string[]): EffectGroup[] {
  const pool = new Set(available)
  const groups: EffectGroup[] = []
  for (const { label, types } of EFFECT_GROUPS) {
    const present = types.filter((t) => pool.delete(t))
    if (present.length > 0) groups.push({ label, types: present })
  }
  if (pool.size > 0) groups.push({ label: 'Other', types: [...pool].sort() })
  return groups
}

/** Build the full effects section (list + add control) for a host. */
export function buildEffectsSection(host: EffectsHost): HTMLElement {
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Effects'))
  const rows = el('div', 'ed-rows')

  const render = (): void => {
    rows.replaceChildren()
    host.getEffects().forEach((ref, index) => {
      rows.append(buildEffectBlock(host, ref, index, render))
    })
  }
  render()

  const types = listEffectTypes().filter((type) => isEffectAllowedOn(type, host.effectHost))
  const addSelect = el('select', 'ed-input')
  for (const group of groupEffectTypes(types)) {
    const optgroup = document.createElement('optgroup')
    optgroup.label = group.label
    for (const type of group.types) {
      const opt = el('option', undefined, type)
      opt.value = type
      optgroup.append(opt)
    }
    addSelect.append(optgroup)
  }
  const add = el('button', 'ed-btn', '+ effect')
  add.type = 'button'
  add.disabled = types.length === 0
  add.addEventListener('click', () => {
    const def = resolveEffect(addSelect.value)
    if (!def) return
    let spec: EffectFormSpec
    try {
      spec = describeEffectSchema(def.schema)
    } catch {
      return
    }
    const schema: ScalarSchema = def.schema
    const params = defaultParamsForEffect(spec, (p) => schema.safeParse(p).success)
    host.setEffects([...host.getEffects(), { type: addSelect.value, ...params }])
    render()
  })

  const addRow = el('div', 'ed-row')
  addRow.append(addSelect, add)
  section.append(rows, addRow)
  return section
}
