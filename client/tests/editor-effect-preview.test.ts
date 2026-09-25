/**
 * The editor's resolved preview line. Node tier: `describeEffectRef` is pure
 * string-building over the shared resolvers.
 *
 * These assertions are the guard on the thing that prompted the preview — that
 * `add`/`mult` shape a *multiplier* while `offset` moves the stat's own unit, so
 * the form has to state which one an author just wrote.
 */

import { describe, expect, it } from 'vitest'
import { parseTreeFile } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { cloneTree } from '../src/dev/editor/model.js'
import { describeEffectRef } from '../src/dev/editor/effect-preview.js'

type Tree = ReturnType<typeof parseTreeFile>

const idler = (): Tree => cloneTree(parseTreeFile(idlerTreeFile))

/** The first active attack that authors both a delay and a cost. */
function activeAttack(tree: Tree) {
  const def = tree.attacks.find(
    (a) => a.kind === 'active' && a.prepareTimeSec !== undefined && a.prepareCost !== undefined,
  )
  expect(def).toBeDefined()
  return def!
}

describe('describeEffectRef — attackStat', () => {
  it('resolves an offset to the seconds it actually removes', () => {
    const tree = idler()
    const def = activeAttack(tree)
    const authored = def.prepareTimeSec!
    const line = describeEffectRef(tree, {
      type: 'attackStat',
      attack: def.id,
      stat: 'prepareTime',
      op: 'offset',
      value: -1,
    })
    expect(line).toBe(
      `${def.id} prepare time: ${authored}s → ${authored - 1}s (L1) · ${authored - 2}s (L2)`,
    )
  })

  it('shows an add for the multiplier it is, not the seconds it looks like', () => {
    const tree = idler()
    const def = activeAttack(tree)
    const authored = def.prepareTimeSec!
    const line = describeEffectRef(tree, {
      type: 'attackStat',
      attack: def.id,
      stat: 'prepareTime',
      op: 'add',
      value: -0.25,
    })
    // `add: -0.25` is ×0.75, a quarter off the wait — not a quarter of a second,
    // which is how the number reads until this line resolves it.
    expect(line).toBe(
      `${def.id} prepare time: ${authored}s → ${authored * 0.75}s (L1) · ${authored * 0.5}s (L2)`,
    )
  })

  it('floors a delay an oversized offset would push below zero', () => {
    const tree = idler()
    const def = activeAttack(tree)
    const line = describeEffectRef(tree, {
      type: 'attackStat',
      attack: def.id,
      stat: 'prepareTime',
      op: 'offset',
      value: -1000,
    })
    expect(line).toContain('0s (L1)')
  })

  it('quotes a prepare cost in its own currencies', () => {
    const tree = idler()
    const def = activeAttack(tree)
    const [currency, entry] = Object.entries(def.prepareCost!)[0]
    const line = describeEffectRef(tree, {
      type: 'attackStat',
      attack: def.id,
      stat: 'prepareCost',
      op: 'mult',
      value: 0.5,
    })
    expect(line).toBe(
      `${def.id} prepare cost: ${entry.baseCost} ${currency} → ${entry.baseCost / 2} ${currency} (L1) · ${entry.baseCost / 4} ${currency} (L2)`,
    )
  })

  it('reports magnitude as a factor — it has no unit of its own', () => {
    const tree = idler()
    const def = activeAttack(tree)
    expect(
      describeEffectRef(tree, {
        type: 'attackStat',
        attack: def.id,
        stat: 'power',
        op: 'mult',
        value: 2,
      }),
    ).toBe(`${def.id} magnitude: ×2 (L1) · ×4 (L2)`)
  })

  it('says nothing for another effect, a missing or unknown attack, or invalid params', () => {
    const tree = idler()
    const attack = activeAttack(tree).id
    expect(describeEffectRef(tree, { type: 'baseModifier', field: 'r0', value: 1 })).toBeNull()
    expect(
      describeEffectRef(tree, { type: 'attackStat', stat: 'power', op: 'mult', value: 2 }),
    ).toBeNull()
    expect(
      describeEffectRef(tree, {
        type: 'attackStat',
        attack: 'a-missing',
        stat: 'power',
        op: 'mult',
        value: 2,
      }),
    ).toBeNull()
    // An offset on a stat with no unit: rejected by the schema, so the form's
    // error line owns it and the preview stays quiet.
    expect(
      describeEffectRef(tree, {
        type: 'attackStat',
        attack,
        stat: 'power',
        op: 'offset',
        value: 1,
      }),
    ).toBeNull()
    expect(
      describeEffectRef(tree, { type: 'attackStat', attack, stat: 'nope', op: 'mult', value: 2 }),
    ).toBeNull()
  })
})
