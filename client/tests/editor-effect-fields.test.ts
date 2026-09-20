import { describe, expect, it } from 'vitest'
import {
  ATTACK_STATS,
  isEffectAllowedOn,
  listEffectTypes,
  parseTreeFile,
  resolveEffect,
} from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { cloneTree } from '../src/dev/editor/model.js'
import { effectFieldOptions } from '../src/dev/editor/effects-editor.js'
import { defaultParamsForEffect, describeEffectSchema } from '../src/dev/editor/effect-schema.js'

const idler = (): ReturnType<typeof parseTreeFile> => cloneTree(parseTreeFile(idlerTreeFile))

describe('effectFieldOptions', () => {
  it('offers the tree’s resources for a stealResource resource', () => {
    const tree = idler()
    expect(effectFieldOptions(tree, 'stealResource', 'resource')).toEqual(tree.resources)
  })

  it('tracks resources added to the tree', () => {
    const tree = idler()
    tree.resources.push('r7')
    expect(effectFieldOptions(tree, 'stealResource', 'resource')).toContain('r7')
  })

  it('offers the tree’s attacks for an attackStat attack', () => {
    const tree = idler()
    expect(effectFieldOptions(tree, 'attackStat', 'attack')).toEqual(tree.attacks.map((a) => a.id))
  })

  // A passive attack is never activated, so `prepareCost`/`prepareTime` mean
  // nothing on it — and `validateModeDefinition` refuses to boot on the pairing.
  // Narrowing the picker is what keeps the author from authoring it at all.
  it('narrows the attackStat stat picker to what the named attack can use', () => {
    const tree = idler()
    const active = tree.attacks.find((a) => a.kind === 'active')!
    const passive = tree.attacks.find((a) => a.kind === 'passive')!

    expect(effectFieldOptions(tree, 'attackStat', 'stat', { attack: active.id })).toEqual([
      ...ATTACK_STATS,
    ])
    expect(effectFieldOptions(tree, 'attackStat', 'stat', { attack: passive.id })).toEqual([
      'power',
    ])
  })

  it('offers every stat when the attackStat names no attack (it buffs all of them)', () => {
    const tree = idler()
    expect(effectFieldOptions(tree, 'attackStat', 'stat')).toEqual([...ATTACK_STATS])
    expect(effectFieldOptions(tree, 'attackStat', 'stat', {})).toEqual([...ATTACK_STATS])
  })

  // The pact effects (plan 42) borrow their vocabularies: a mirrored discount
  // names what the enemy bought from the enemy-cost catalog, a mirrored bonus
  // reads an enemy stat and lands on a debuff target.
  it('offers the cost-target catalog for a mirrorCostModifier target', () => {
    const options = effectFieldOptions(idler(), 'mirrorCostModifier', 'target')!
    const values = options.map((o) => (typeof o === 'string' ? o : o.value))
    expect(values).toContain('upgrades')
    expect(values).toContain('generator:g0')
    expect(values).toContain('upgrade:be-af-mr')
  })

  it('offers the enemy-stat catalog for a mirrorStatModifier source and the debuff targets for its field', () => {
    const tree = idler()
    const sources = effectFieldOptions(tree, 'mirrorStatModifier', 'source')!.map((o) =>
      typeof o === 'string' ? o : o.value,
    )
    expect(sources).toEqual(
      expect.arrayContaining(['r0', 'r0:rate', 'peakCps', 'score', 'generator:g0', 'upgrades']),
    )
    const fields = effectFieldOptions(tree, 'mirrorStatModifier', 'field')!.map((o) =>
      typeof o === 'string' ? o : o.value,
    )
    expect(fields).toEqual(['clickIncome', 'highlightFactor', ...tree.resources])
  })

  it('leaves an unmapped effect/field pair as free text', () => {
    expect(effectFieldOptions(idler(), 'stealResource', 'fraction')).toBeUndefined()
    expect(effectFieldOptions(idler(), 'highlightMultiplier', 'multiplier')).toBeUndefined()
  })

  // Every string param of a registered effect names something the boot-time
  // validator checks (a resource, generator, panel, attack, …), so all of them
  // must render as pickers — a free-text box invites a typo the editor happily
  // saves and the game then refuses to boot on. Enum fields carry their own
  // members via the schema, so they need no mapping here.
  it('gives every string param of every registered effect a picker', () => {
    const tree = idler()
    const freeText: string[] = []
    for (const type of listEffectTypes()) {
      const def = resolveEffect(type)
      if (!def) continue
      let variants
      try {
        variants = describeEffectSchema(def.schema).variants
      } catch {
        continue // schema shape the form can't render at all — nothing to check
      }
      for (const variant of variants) {
        for (const field of variant.fields) {
          if (field.kind !== 'string' || field.options) continue
          if (effectFieldOptions(tree, type, field.key) === undefined)
            freeText.push(`${type}.${field.key}`)
        }
      }
    }
    expect(freeText).toEqual([])
  })
})

// The "+ effect" button writes the seeded defaults into the tree unchecked, so
// params the effect's own schema rejects become a node that refuses to boot —
// with nothing said until some field is touched. The candidate ladder in
// `defaultParamsForEffect` is what keeps a guarded number from landing there.
describe('default params for a newly added effect', () => {
  it('seeds every registered effect with params its own schema accepts', () => {
    const rejected: string[] = []
    for (const type of listEffectTypes()) {
      const def = resolveEffect(type)
      if (!def) continue
      let spec
      try {
        spec = describeEffectSchema(def.schema)
      } catch {
        continue // schema shape the form can't render at all — nothing to seed
      }
      const params = defaultParamsForEffect(spec, (p) => def.schema.safeParse(p).success)
      if (!def.schema.safeParse(params).success) rejected.push(type)
    }
    expect(rejected).toEqual([])
  })

  it('leaves 0 in place where the schema is happy with it', () => {
    // The ladder tries `0` first, so an unguarded number still opens on the
    // value the form has always shown.
    const def = resolveEffect('baseModifier')!
    const spec = describeEffectSchema(def.schema)
    const params = defaultParamsForEffect(spec, (p) => def.schema.safeParse(p).success)
    // `baseModifier` guards its value as a bonus, so this one does move — but
    // only to the first candidate that parses.
    expect(params.value).toBe(2)
    expect(def.schema.safeParse({ ...params, value: 0 }).success).toBe(false)
  })
})

describe('effect hosts', () => {
  const typesFor = (host: Parameters<typeof isEffectAllowedOn>[1]): string[] =>
    listEffectTypes().filter((type) => isEffectAllowedOn(type, host))

  // What the editor's "+ effect" picker offers per section (see EffectsHost).
  it('offers only offensive effects on attacks, steals on active ones only', () => {
    expect(typesFor('passiveAttack')).toEqual(['enemyCostModifier', 'enemyProductionModifier'])
    // The debuff pair rides both kinds: always-on on a passive attack, a timed
    // window (`durationSec`) on an active one (plan 37). The purchase lock
    // (plan 40) is active-only — a permanent embargo is a loss condition, not a
    // debuff — so it appears here and nowhere else.
    expect(typesFor('activeAttack')).toEqual([
      'enemyCostModifier',
      'enemyProductionModifier',
      'enemyPurchaseLock',
      'stealGenerator',
      'stealResource',
    ])
  })

  // The pact effects (plan 42) ride both pact kinds: continuous on a passive
  // pact, and declared on an active one ahead of its reader (plan 44).
  it('offers only the pact effects on pacts', () => {
    expect(typesFor('passivePact')).toEqual(['mirrorCostModifier', 'mirrorStatModifier'])
    expect(typesFor('activePact')).toEqual(typesFor('passivePact'))
    expect(typesFor('upgrade')).not.toContain('mirrorCostModifier')
    expect(typesFor('upgrade')).not.toContain('mirrorStatModifier')
    expect(typesFor('passiveAttack')).not.toContain('mirrorCostModifier')
  })

  it('offers every production effect on upgrades and the mode, and no offensive one', () => {
    const upgrade = typesFor('upgrade')
    expect(upgrade).toEqual(typesFor('mode'))
    expect(upgrade).toContain('baseModifier')
    expect(upgrade).toContain('panelUnlock')
    // An attack *stat* is granted by an upgrade, not carried by the attack.
    expect(upgrade).toContain('attackStat')
    expect(typesFor('activeAttack')).not.toContain('attackStat')
    expect(upgrade).not.toContain('stealResource')
    expect(upgrade).not.toContain('enemyProductionModifier')
  })

  // Every registered effect must be authorable somewhere, or the picker hides it
  // in every section and it can only be authored by hand.
  it('leaves no effect unreachable from every host', () => {
    const reachable = new Set([
      ...typesFor('mode'),
      ...typesFor('upgrade'),
      ...typesFor('passiveAttack'),
      ...typesFor('activeAttack'),
      ...typesFor('passivePact'),
      ...typesFor('activePact'),
    ])
    expect([...listEffectTypes()].filter((t) => !reachable.has(t))).toEqual([])
  })
})
