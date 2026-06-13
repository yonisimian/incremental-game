/**
 * Effect-schema introspection — turns a registered effect's zod param schema
 * into a flat form description the inspector can render. Pure (no DOM), so it is
 * unit-tested directly.
 *
 * Deliberately handles only the schema shapes our effects actually use: a strict
 * object of scalar fields, optionally wrapped in `optional`/`default`, and a
 * union of such objects (rendered as a variant picker). Anything richer throws
 * `UnsupportedEffectSchemaError`, so the inspector can hide that effect rather
 * than render a broken form. Param *validation* still happens against the real
 * zod schema at the edit boundary — this only describes the inputs to show.
 *
 * Typed structurally (no `zod` import) so the dev client needn't depend on zod:
 * a schema is anything exposing the `def` node we read.
 */

type FieldKind = 'number' | 'string' | 'boolean'

/** One editable param: its key, scalar kind, and optionality/default. */
export interface FieldSpec {
  readonly key: string
  readonly kind: FieldKind
  readonly optional: boolean
  readonly defaultValue?: number | string | boolean
}

/** One object shape of an effect's params (a union member, or the lone object). */
export interface VariantSpec {
  /** Index into the schema's union options (`0` for a non-union object). */
  readonly index: number
  readonly fields: readonly FieldSpec[]
  /** Human label — the field names joined (e.g. `multiplier + boostUpgradeId`). */
  readonly label: string
}

/** The full form description for an effect: one or more param variants. */
export interface EffectFormSpec {
  readonly variants: readonly VariantSpec[]
}

/** Thrown when a schema uses a shape this introspector intentionally doesn't model. */
export class UnsupportedEffectSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedEffectSchemaError'
  }
}

// ─── zod v4 internals ────────────────────────────────────────────────
//
// zod exposes a node's shape via `schema.def`. We read only the few fields we
// model and cast through this minimal view (the public types don't describe the
// traversal). Touching internals is the price of schema-driven forms; it is
// contained here and guarded by tests.

/** The minimal structural view of a zod schema node this module reads. */
export interface SchemaNode {
  readonly def: ZodDef
}

interface ZodDef {
  readonly type: string
  readonly options?: readonly SchemaNode[]
  readonly shape?: Readonly<Record<string, SchemaNode>>
  readonly innerType?: SchemaNode
  readonly defaultValue?: unknown
}

function defOf(schema: SchemaNode): ZodDef {
  return schema.def
}

/** Unwrap `optional`/`default` wrappers, tracking optionality + any default value. */
function unwrap(schema: SchemaNode): {
  inner: SchemaNode
  optional: boolean
  defaultValue: number | string | boolean | undefined
} {
  let inner = schema
  let optional = false
  let defaultValue: number | string | boolean | undefined
  for (;;) {
    const def = defOf(inner)
    if (def.type === 'optional' && def.innerType) {
      optional = true
      inner = def.innerType
    } else if (def.type === 'default' && def.innerType) {
      const dv = def.defaultValue
      if (typeof dv === 'number' || typeof dv === 'string' || typeof dv === 'boolean') {
        defaultValue = dv
      }
      inner = def.innerType
    } else {
      break
    }
  }
  return { inner, optional, defaultValue }
}

function describeField(key: string, schema: SchemaNode): FieldSpec {
  const { inner, optional, defaultValue } = unwrap(schema)
  const type = defOf(inner).type
  if (type !== 'number' && type !== 'string' && type !== 'boolean') {
    throw new UnsupportedEffectSchemaError(`Field '${key}' has unsupported type '${type}'`)
  }
  return { key, kind: type, optional, defaultValue }
}

function describeVariant(schema: SchemaNode, index: number): VariantSpec {
  const def = defOf(schema)
  if (def.type !== 'object' || !def.shape) {
    throw new UnsupportedEffectSchemaError(`Expected an object variant, got '${def.type}'`)
  }
  const fields = Object.entries(def.shape).map(([key, field]) => describeField(key, field))
  return { index, fields, label: fields.map((f) => f.key).join(' + ') || '(no params)' }
}

/**
 * Describe an effect's param schema as one or more variants. Throws
 * `UnsupportedEffectSchemaError` for shapes outside the modeled subset.
 */
export function describeEffectSchema(schema: SchemaNode): EffectFormSpec {
  const def = defOf(schema)
  if (def.type === 'union' && def.options) {
    return { variants: def.options.map((opt, i) => describeVariant(opt, i)) }
  }
  return { variants: [describeVariant(schema, 0)] }
}

/**
 * Pick the variant that best fits an existing params object: the first whose
 * fields cover every present key and whose required fields are all present.
 * Falls back to the first variant.
 */
export function matchVariant(
  spec: EffectFormSpec,
  params: Readonly<Record<string, unknown>>,
): VariantSpec {
  const presentKeys = Object.keys(params)
  for (const variant of spec.variants) {
    const fieldKeys = new Set(variant.fields.map((f) => f.key))
    const covered = presentKeys.every((k) => fieldKeys.has(k))
    const requiredPresent = variant.fields
      .filter((f) => !f.optional)
      .every((f) => params[f.key] !== undefined)
    if (covered && requiredPresent) return variant
  }
  return spec.variants[0]
}

/** Build a params object for a variant from its defaults (skips optionals w/o a default). */
export function defaultParamsForVariant(
  variant: VariantSpec,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const field of variant.fields) {
    if (field.optional && field.defaultValue === undefined) continue
    out[field.key] =
      field.defaultValue ?? (field.kind === 'number' ? 0 : field.kind === 'string' ? '' : false)
  }
  return out
}

/**
 * Default params for a newly-added effect: the first variant whose defaults the
 * caller's `isValid` predicate accepts (so a union prefers a shape that parses
 * cleanly), falling back to the first variant. `isValid` is the effect's real
 * schema check, kept out of this module to avoid a zod dependency.
 */
export function defaultParamsForEffect(
  spec: EffectFormSpec,
  isValid: (params: Record<string, number | string | boolean>) => boolean,
): Record<string, number | string | boolean> {
  for (const variant of spec.variants) {
    const params = defaultParamsForVariant(variant)
    if (isValid(params)) return params
  }
  return defaultParamsForVariant(spec.variants[0])
}
