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
  enemyDataKeysFor,
  enemyDebuffTargetsFor,
  NON_RESOURCE_INTEL_KEYS,
  isEffectAllowedOn,
  listEffectTypes,
  resolveEffect,
  UNLOCKABLE_SYSTEMS,
  type EffectHost,
  type TreeFile,
} from '@game/shared'

import {
  defaultParamsForEffect,
  defaultParamsForVariant,
  describeEffectSchema,
  matchVariant,
  type EffectFormSpec,
  type FieldSpec,
} from './effect-schema.js'
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
 * `accessEnemyData`'s `data` from the tree's resource keys (stockpile) plus a
 * `:rate` variant per resource (per-second production) and the non-resource
 * intel keys (peak CPS, purchases), and `stealResource`'s `resource` from the
 * tree's resource keys. `relativeModifier`'s `field`/`source` come from the
 * shared addressable-field catalog (labelled), the same set the
 * boot-time validator enforces; `enemyProductionModifier`'s `field` uses the
 * narrower enemy-debuff catalog (resource rates only — generator/click targets
 * don't apply to a debuff).
 *
 * Exported for testing: every id-referencing param should resolve to a picker,
 * so free text can never author a key the boot-time validator would reject.
 */
export function effectFieldOptions(
  tree: TreeFile,
  effectType: string,
  fieldKey: string,
): readonly EffectFieldOption[] | undefined {
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
  if (effectType === 'unlockAttack' && fieldKey === 'attack') {
    return tree.attacks.map((a) => a.id)
  }
  if (effectType === 'stealResource' && fieldKey === 'resource') {
    return tree.resources
  }
  if (effectType === 'unlockPact' && fieldKey === 'pact') {
    return tree.pacts.map((p) => p.id)
  }
  // `baseModifier` targets the same production catalog the boot-time validator
  // enforces: each resource's global rate (`rK`) and isolated base producer
  // (`bK`), each generator, plus the `clickIncome` special.
  if (effectType === 'baseModifier' && fieldKey === 'field') {
    return addressableTargetsFor(
      tree.resources,
      tree.generators.map((g) => g.id),
    ).map((f) => ({ value: f.key, label: f.label }))
  }
  return undefined
}

function buildEffectField(
  spec: FieldSpec,
  current: unknown,
  onChange: () => void,
  options?: readonly EffectFieldOption[],
): { row: HTMLElement; read: () => unknown } {
  const label = spec.optional ? `${spec.key} (optional)` : spec.key
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
    const select = el('select', 'ed-input')
    const value = typeof current === 'string' ? current : ''
    if (value !== '' && !selectOptions.some((o) => o.value === value)) {
      const opt = el('option', undefined, `${value} (unknown)`)
      opt.value = value
      opt.selected = true
      select.append(opt)
    }
    for (const { value: optValue, label: optLabel } of selectOptions) {
      const opt = el('option', undefined, optLabel)
      opt.value = optValue
      if (optValue === value) opt.selected = true
      select.append(opt)
    }
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

  const writeFrom = (values: Record<string, unknown>, silent = false): void => {
    const result = schema.safeParse(values)
    if (!result.success) {
      error.textContent = silent ? '' : (result.error?.issues[0]?.message ?? 'Invalid params')
      return
    }
    error.textContent = ''
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
    for (const fieldSpec of variant.fields) {
      const { row, read } = buildEffectField(
        fieldSpec,
        params[fieldSpec.key],
        () => {
          writeFrom(collect())
        },
        effectFieldOptions(host.tree, ref.type, fieldSpec.key),
      )
      reads.set(fieldSpec.key, read)
      fieldsWrap.append(row)
    }
  }
  buildFields()

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
      params = defaultParamsForVariant(picked)
      buildFields()
      // Seeded defaults for a stricter variant (e.g. an empty required id) may
      // not parse yet; persist if valid but don't flash an error before the
      // user has touched the new fields.
      writeFrom(params, true)
    })
    block.append(field('Shape', variantSelect))
  }

  block.append(fieldsWrap, error)
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
  { label: 'Offense', types: ['stealResource'] },
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
