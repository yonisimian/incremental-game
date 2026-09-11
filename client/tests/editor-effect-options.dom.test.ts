// @vitest-environment happy-dom
//
// The effects editor's dependent option sets: changing a param that *narrows*
// another param's picker has to re-resolve the block and drop a choice the new
// options no longer offer. `attackStat` is the case — a passive attack is never
// activated, so naming one removes `prepareCost`/`prepareTime` from `stat`, and a
// stat left selected would be written straight into the tree file for
// `validateModeDefinition` to refuse at startup.
//
// Also covers the form's display names (`op` → "operator", `mult` →
// "multiply"), which must stay cosmetic — the tree file keeps the schema's own
// spelling.
//
// DOM tier because the mechanism *is* the live select: the handler reads the
// mounted controls, rebuilds the rows, and persists. Asserting it against a
// string render would test nothing.

import { beforeEach, describe, expect, it } from 'vitest'
import { parseTreeFile } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { cloneTree } from '../src/dev/editor/model.js'
import { buildEffectsSection } from '../src/dev/editor/effects-editor.js'

interface EffectEntry {
  readonly type: string
  readonly [param: string]: unknown
}

type Tree = ReturnType<typeof parseTreeFile>

const idler = (): Tree => cloneTree(parseTreeFile(idlerTreeFile))

const activeId = (tree: Tree): string => tree.attacks.find((a) => a.kind === 'active')!.id
const passiveId = (tree: Tree): string => tree.attacks.find((a) => a.kind === 'passive')!.id

/** Mount an effects section holding one ref; returns handles onto the live form. */
function mount(tree: Tree, initial: EffectEntry) {
  let effects: readonly EffectEntry[] = [initial]
  const section = buildEffectsSection({
    tree,
    effectHost: 'upgrade',
    getEffects: () => effects,
    setEffects: (next) => {
      effects = next
    },
  })
  document.body.append(section)
  // Field order follows the schema: attack, stat, op (`value` is a number input).
  const selects = (): HTMLSelectElement[] => [...section.querySelectorAll('select')]
  return {
    saved: (): EffectEntry => effects[0],
    attackSelect: (): HTMLSelectElement => selects()[0],
    statOptions: (): string[] => [...selects()[1].options].map((o) => o.value),
    statSelect: (): HTMLSelectElement => selects()[1],
    opSelect: (): HTMLSelectElement => selects()[2],
    labels: (): string[] =>
      [...section.querySelectorAll('.ed-field-label')].map((l) => l.textContent),
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('effects editor — attackStat stat picker', () => {
  it('drops the activation-only stats when the attack becomes a passive one', () => {
    const tree = idler()
    const { attackSelect, statSelect, statOptions, saved } = mount(tree, {
      type: 'attackStat',
      attack: activeId(tree),
      stat: 'prepareCost',
      op: 'mult',
      value: 0.5,
    })

    // An active attack is activated, so every stat applies — and the form opens
    // on the authored choice rather than on whatever option happens to be first.
    expect(statOptions()).toContain('prepareCost')
    expect(statSelect().value).toBe('prepareCost')

    attackSelect().value = passiveId(tree)
    attackSelect().dispatchEvent(new Event('change'))

    // The picker narrows, and the now-illegal choice is snapped to the only stat
    // left rather than being persisted as authored.
    expect(statOptions()).toEqual(['power'])
    expect(saved()).toEqual({
      type: 'attackStat',
      attack: passiveId(tree),
      stat: 'power',
      op: 'mult',
      value: 0.5,
    })
  })

  it('restores the full list when the attack goes back to an active one', () => {
    const tree = idler()
    const { attackSelect, statOptions, saved } = mount(tree, {
      type: 'attackStat',
      attack: passiveId(tree),
      stat: 'power',
      op: 'mult',
      value: 2,
    })
    expect(statOptions()).toEqual(['power'])

    attackSelect().value = activeId(tree)
    attackSelect().dispatchEvent(new Event('change'))

    expect(statOptions()).toContain('prepareTime')
    // `power` is legal either way, so nothing is repaired.
    expect(saved().stat).toBe('power')
  })

  it('titles the operator field and says which ops are relative', () => {
    const tree = idler()
    const { opSelect, labels, saved } = mount(tree, {
      type: 'attackStat',
      attack: activeId(tree),
      stat: 'power',
      op: 'mult',
      value: 2,
    })

    expect(labels()).toContain('operator')
    expect(labels()).not.toContain('op')
    // `magnitude` has no unit, so the absolute op is not on offer — and the two
    // relative ops name what they shape, since "add 5" is a ×6, not a +5.
    expect([...opSelect().options].map((o) => [o.value, o.textContent])).toEqual([
      ['add', '+ to multiplier'],
      ['mult', '× multiplier'],
    ])
    // Cosmetic only: the tree file still carries the schema's own spelling.
    expect(opSelect().value).toBe('mult')
    expect(saved().op).toBe('mult')
  })

  it('offers the absolute op on prepare time alone', () => {
    const tree = idler()
    const { statSelect, opSelect, saved } = mount(tree, {
      type: 'attackStat',
      attack: activeId(tree),
      stat: 'prepareTime',
      op: 'offset',
      value: -1,
    })
    expect([...opSelect().options].map((o) => [o.value, o.textContent])).toEqual([
      ['add', '+ to multiplier'],
      ['mult', '× multiplier'],
      ['offset', 'offset (seconds)'],
    ])

    // Moving to a stat with no unit takes `offset` away — and the selected op
    // with it, since the schema would reject the pairing at load.
    statSelect().value = 'power'
    statSelect().dispatchEvent(new Event('change'))
    expect([...opSelect().options].map((o) => o.value)).toEqual(['add', 'mult'])
    expect(saved().op).toBe('add')
  })

  it('cascades attack → stat → op in one edit', () => {
    const tree = idler()
    const { attackSelect, statOptions, opSelect, saved } = mount(tree, {
      type: 'attackStat',
      attack: activeId(tree),
      stat: 'prepareTime',
      op: 'offset',
      value: -1,
    })

    // A passive attack has no delay, so `prepareTime` goes — which in turn takes
    // `offset` with it. Both repairs have to land from the one change event.
    attackSelect().value = passiveId(tree)
    attackSelect().dispatchEvent(new Event('change'))

    expect(statOptions()).toEqual(['power'])
    expect([...opSelect().options].map((o) => o.value)).toEqual(['add', 'mult'])
    expect(saved()).toEqual({
      type: 'attackStat',
      attack: passiveId(tree),
      stat: 'power',
      op: 'add',
      value: -1,
    })
  })

  it('offers every stat while no attack is named — it buffs all of them', () => {
    const tree = idler()
    const { attackSelect, statOptions, saved } = mount(tree, {
      type: 'attackStat',
      stat: 'prepareTime',
      op: 'mult',
      value: 0.5,
    })
    expect(statOptions()).toContain('prepareTime')
    // The optional picker's blank entry is the way back to "every attack".
    expect(attackSelect().value).toBe('')
    expect(saved().stat).toBe('prepareTime')
  })
})
