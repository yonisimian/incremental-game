import { describe, expect, it } from 'vitest'
import { isEffectAllowedOn, listEffectTypes, parseTreeFile, resolveEffect } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { cloneTree } from '../src/dev/editor/model.js'
import { effectFieldOptions } from '../src/dev/editor/effects-editor.js'
import { describeEffectSchema } from '../src/dev/editor/effect-schema.js'

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

describe('effect hosts', () => {
  const typesFor = (host: Parameters<typeof isEffectAllowedOn>[1]): string[] =>
    listEffectTypes().filter((type) => isEffectAllowedOn(type, host))

  // What the editor's "+ effect" picker offers per section (see EffectsHost).
  it('offers only offensive effects on attacks, and only on the matching kind', () => {
    expect(typesFor('passiveAttack')).toEqual(['enemyProductionModifier'])
    expect(typesFor('activeAttack')).toEqual(['stealGenerator', 'stealResource'])
  })

  it('offers every production effect on upgrades and the mode, and no offensive one', () => {
    const upgrade = typesFor('upgrade')
    expect(upgrade).toEqual(typesFor('mode'))
    expect(upgrade).toContain('baseModifier')
    expect(upgrade).toContain('panelUnlock')
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
    ])
    expect([...listEffectTypes()].filter((t) => !reachable.has(t))).toEqual([])
  })
})
