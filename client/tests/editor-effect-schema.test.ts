import { describe, expect, it } from 'vitest'
import { resolveEffect } from '@game/shared'
import {
  defaultParamsForEffect,
  defaultParamsForVariant,
  describeEffectSchema,
  matchVariant,
  UnsupportedEffectSchemaError,
  type SchemaNode,
} from '../src/dev/editor/effect-schema.js'

// Fabricate minimal structural schema nodes (no zod dependency in the client).
const number: SchemaNode = { def: { type: 'number' } }
const string: SchemaNode = { def: { type: 'string' } }
const boolean: SchemaNode = { def: { type: 'boolean' } }
const optional = (inner: SchemaNode): SchemaNode => ({
  def: { type: 'optional', innerType: inner },
})
const withDefault = (inner: SchemaNode, defaultValue: unknown): SchemaNode => ({
  def: { type: 'default', innerType: inner, defaultValue },
})
const object = (shape: Record<string, SchemaNode>): SchemaNode => ({
  def: { type: 'object', shape },
})
const union = (...options: SchemaNode[]): SchemaNode => ({ def: { type: 'union', options } })
const enumOf = (...values: string[]): SchemaNode => ({
  def: { type: 'enum', entries: Object.fromEntries(values.map((v) => [v, v])) },
})

describe('describeEffectSchema', () => {
  it('describes a flat object of scalar fields', () => {
    const spec = describeEffectSchema(object({ multiplier: number, label: string, on: boolean }))
    expect(spec.variants).toHaveLength(1)
    expect(spec.variants[0].fields).toEqual([
      { key: 'multiplier', kind: 'number', optional: false, defaultValue: undefined },
      { key: 'label', kind: 'string', optional: false, defaultValue: undefined },
      { key: 'on', kind: 'boolean', optional: false, defaultValue: undefined },
    ])
    expect(spec.variants[0].label).toBe('multiplier + label + on')
  })

  it('unwraps optional and default wrappers', () => {
    const spec = describeEffectSchema(object({ a: optional(string), b: withDefault(number, 5) }))
    expect(spec.variants[0].fields).toEqual([
      { key: 'a', kind: 'string', optional: true, defaultValue: undefined },
      { key: 'b', kind: 'number', optional: false, defaultValue: 5 },
    ])
  })

  it('describes a union as one variant per object option', () => {
    const spec = describeEffectSchema(
      union(object({ multiplier: number, boost: string }), object({ multiplier: number })),
    )
    expect(spec.variants.map((v) => v.index)).toEqual([0, 1])
    expect(spec.variants[0].label).toBe('multiplier + boost')
    expect(spec.variants[1].label).toBe('multiplier')
  })

  it('throws on an unsupported field type', () => {
    expect(() => describeEffectSchema(object({ tags: { def: { type: 'array' } } }))).toThrow(
      UnsupportedEffectSchemaError,
    )
  })

  it('throws when the root is neither object nor union', () => {
    expect(() => describeEffectSchema(number)).toThrow(UnsupportedEffectSchemaError)
  })

  it('describes an enum field as a string picker defaulting to its first member', () => {
    const spec = describeEffectSchema(
      object({ stage: enumOf('additive', 'multiplicative', 'global') }),
    )
    expect(spec.variants[0].fields).toEqual([
      {
        key: 'stage',
        kind: 'string',
        optional: false,
        defaultValue: 'additive',
        options: ['additive', 'multiplicative', 'global'],
      },
    ])
  })

  it('describes the registered highlightMultiplier effect', () => {
    const def = resolveEffect('highlightMultiplier')!
    const spec = describeEffectSchema(def.schema)
    expect(spec.variants).toHaveLength(1)
    expect(spec.variants[0].fields.map((f) => f.key)).toEqual(['multiplier'])
  })

  it('describes the registered baseModifier effect (enum stage + scalar fields)', () => {
    const def = resolveEffect('baseModifier')!
    const spec = describeEffectSchema(def.schema)
    expect(spec.variants).toHaveLength(1)
    const fields = spec.variants[0].fields
    expect(fields.map((f) => f.key)).toEqual(['stage', 'field', 'value'])
    expect(fields[0]).toEqual({
      key: 'stage',
      kind: 'string',
      optional: false,
      defaultValue: 'additive',
      options: ['additive', 'multiplicative', 'global'],
    })
  })
})

describe('matchVariant', () => {
  const spec = describeEffectSchema(
    union(object({ multiplier: number, boost: string }), object({ multiplier: number })),
  )

  it('picks the larger variant when its required fields are present', () => {
    expect(matchVariant(spec, { multiplier: 2, boost: 'x' }).index).toBe(0)
  })

  it('picks the smaller variant when extra fields are absent', () => {
    expect(matchVariant(spec, { multiplier: 2 }).index).toBe(1)
  })
})

describe('defaultParamsForVariant', () => {
  it('fills scalar defaults and skips optionals without a default', () => {
    const spec = describeEffectSchema(
      object({ a: number, b: string, c: boolean, d: optional(number), e: withDefault(number, 7) }),
    )
    expect(defaultParamsForVariant(spec.variants[0])).toEqual({ a: 0, b: '', c: false, e: 7 })
  })
})

describe('defaultParamsForEffect', () => {
  const spec = describeEffectSchema(
    union(object({ multiplier: number, boost: string }), object({ multiplier: number })),
  )

  it('prefers the first variant whose defaults pass the validity check', () => {
    // The boost variant seeds an empty string, which a min(1) rule rejects;
    // the narrow variant's defaults parse, so they win.
    const isValid = (p: Record<string, unknown>): boolean =>
      typeof p.boost !== 'string' || p.boost.length > 0
    expect(defaultParamsForEffect(spec, isValid)).toEqual({ multiplier: 0 })
  })

  it('falls back to the first variant when none validate', () => {
    expect(defaultParamsForEffect(spec, () => false)).toEqual({ multiplier: 0, boost: '' })
  })
})
