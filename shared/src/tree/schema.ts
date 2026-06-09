import { z } from 'zod'

import type { PrerequisiteExpression } from '../types.js'

/**
 * On-disk schema version. Bump when the file shape changes incompatibly and add
 * a migration step in `migrateTreeFile` (see `codec.ts`).
 */
export const CURRENT_TREE_VERSION = 1

// ─── Leaf schemas ────────────────────────────────────────────────────

/** A position is the offset from a node's layout parent (roots: from the origin). */
const PositionSchema = z.object({ x: z.number(), y: z.number() })

const ModifierSchema = z.object({
  stage: z.enum(['additive', 'multiplicative', 'global']),
  field: z.string(),
  value: z.number(),
})

/** Cost as a `currency → amount` map (e.g. `{ r0: 15, r1: 5 }`). */
const CostSchema = z.record(z.string(), z.number())

const CostScalingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('linear'), baseCost: z.number(), factor: z.number() }),
  z.object({ type: z.literal('exponential'), baseCost: z.number(), factor: z.number() }),
])

/**
 * Recursive AND/OR prerequisite expression. Annotated with the existing runtime
 * type so the inferred file shape matches the engine's `PrerequisiteExpression`.
 */
const PrerequisiteSchema: z.ZodType<PrerequisiteExpression> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('upgrade'),
      id: z.string(),
      minLevel: z.number().int().min(1).optional(),
    }),
    z.object({ type: z.literal('all'), items: z.array(PrerequisiteSchema) }),
    z.object({ type: z.literal('any'), items: z.array(PrerequisiteSchema) }),
  ]),
)

/**
 * A declarative effect ref: a `type` discriminant plus inline params. Params are
 * kept verbatim (loose object) and validated per-effect by the registry once the
 * tree is assembled into a `ModeDefinition` — see `validateModeDefinition`.
 */
const EffectRefSchema = z.looseObject({ type: z.string() })

const GoalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('timed'), label: z.string(), durationSec: z.number() }),
  z.object({
    type: z.literal('target-score'),
    label: z.string(),
    target: z.number(),
    safetyCapSec: z.number(),
  }),
  z.object({ type: z.literal('buy-upgrade'), label: z.string(), safetyCapSec: z.number() }),
])

const GeneratorSchema = z.object({
  id: z.string(),
  baseCost: z.number(),
  costScaling: z.number(),
  costCurrency: z.string(),
  production: z.object({ resource: z.string(), rate: z.number() }),
})

// ─── Flavor schemas ──────────────────────────────────────────────────

const ResourceFlavorSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  icon: z.string(),
  className: z.string().optional(),
})

const UpgradeFlavorSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  description: z.string(),
})

const GeneratorFlavorSchema = z.object({ id: z.string(), name: z.string(), icon: z.string() })

const ModeFlavorSchema = z.object({
  displayName: z.string(),
  themeClass: z.string(),
  scoreLabel: z.string(),
  resources: z.array(ResourceFlavorSchema),
  showClickStats: z.boolean(),
  upgrades: z.array(UpgradeFlavorSchema),
  generators: z.array(GeneratorFlavorSchema),
})

// ─── Upgrade tree node (serializable authoring form) ─────────────────

/**
 * Serializable authoring node. Mirrors `UpgradeTreeNode` but with two file-format
 * differences: `purchaseLimit` is `number | null` (`null` = unlimited, since JSON
 * cannot encode `Infinity`), and `position` is expressed as a relative `offset`.
 * The `codec` maps `null → Infinity` and flattens offsets to absolute positions.
 */
const UpgradeNodeSchema = z.object({
  id: z.string(),
  cost: CostSchema,
  costScaling: CostScalingSchema.optional(),
  /** Max purchases; `null` means unlimited (maps to `Infinity` at runtime). */
  purchaseLimit: z.number().nullable(),
  modifiers: z.array(ModifierSchema),
  choiceGroup: z.string().optional(),
  choiceLabel: z.string().optional(),
  prerequisites: PrerequisiteSchema.optional(),
  goalType: z.enum(['timed', 'target-score', 'buy-upgrade']).optional(),
  effects: z.array(EffectRefSchema).optional(),
  offset: PositionSchema,
  get children() {
    return z.array(UpgradeNodeSchema).optional()
  },
})

// ─── Top-level tree file ─────────────────────────────────────────────

/**
 * The complete on-disk shape of a mode: everything that is pure data (the whole
 * `ModeDefinition` minus executable behavior), with upgrades in nested authoring
 * form. `parseTree` (see `codec.ts`) is the single boundary that turns this into
 * a runtime `ModeDefinition`.
 */
export const TreeFileSchema = z.object({
  version: z.literal(CURRENT_TREE_VERSION),
  /** Mode key (e.g. 'idler') — used for validation messages and registration. */
  id: z.string(),
  resources: z.array(z.string()),
  scoreResource: z.string(),
  clicksEnabled: z.boolean(),
  highlightEnabled: z.boolean(),
  highlightUnlockUpgrade: z.string().optional(),
  initialResources: z.record(z.string(), z.number()),
  initialMeta: z.record(z.string(), z.unknown()),
  nativeModifiers: z.array(ModifierSchema),
  effects: z.array(EffectRefSchema).optional(),
  generators: z.array(GeneratorSchema),
  goals: z.array(GoalSchema),
  flavor: ModeFlavorSchema,
  upgrades: z.array(UpgradeNodeSchema),
})

/** A validated tree file (inferred from {@link TreeFileSchema}). */
export type TreeFile = z.infer<typeof TreeFileSchema>

/** A serializable authoring node (inferred from its schema). */
export type TreeUpgradeNode = z.infer<typeof UpgradeNodeSchema>
