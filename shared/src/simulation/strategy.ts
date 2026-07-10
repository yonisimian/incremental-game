// @game/shared — timeline-free strategy model for the headless simulator.
//
// A strategy is an *ordered queue* of actions with NO timestamps: the author
// controls order, the engine (see `simulate.ts`) derives timing by advancing
// simulated time until each action can fire, then moving to the next. See
// docs/plans/23-timeline-strategy-simulation.md for the full design.
//
// The zod schema is the trust boundary for save/load. It validates the shape
// (kinds, positive counts, cps within [0, MAX_CPS]); validating that referenced
// upgrade/generator/resource IDs exist for a given mode is a separate,
// mode-aware step (`validateStrategyForMode` below).

import { z } from 'zod'

import { MAX_CPS } from '../game-config.js'
import { AVAILABLE_MODES } from '../modes/index.js'
import type { ModeDefinition } from '../modes/types.js'
import type { GameMode } from '../types.js'

// ─── Wait conditions ─────────────────────────────────────────────────
//
// v1 ships only the two zero-cost predicates. `clicks` and `resource_gained`
// are deferred (they need new engine state) — see the plan's "Deferred to future
// work" section.

const WaitConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('seconds'), seconds: z.number().positive() }),
  z.strictObject({
    kind: z.literal('resource_at_least'),
    resource: z.string(),
    amount: z.number().positive(),
  }),
])

// ─── Actions ─────────────────────────────────────────────────────────

const SimActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('buy'),
    upgradeId: z.string(),
    /** How many levels to buy back-to-back; each blocks until affordable. Default 1. */
    count: z.number().int().positive().optional(),
  }),
  z.strictObject({
    kind: z.literal('buy_generator'),
    generatorId: z.string(),
    /** How many units to buy back-to-back; each blocks until affordable. Default 1. */
    count: z.number().int().positive().optional(),
  }),
  z.strictObject({ kind: z.literal('set_highlight'), highlight: z.string() }),
  z.strictObject({
    kind: z.literal('set_click_rate'),
    resource: z.string().optional(),
    cps: z.number().min(0).max(MAX_CPS),
  }),
  z.strictObject({ kind: z.literal('wait'), until: WaitConditionSchema }),
])

export const QueueStrategySchema = z.strictObject({
  /** Schema version for forward-compatible save files. */
  version: z.literal(1),
  name: z.string(),
  mode: z.enum(AVAILABLE_MODES as unknown as [GameMode, ...GameMode[]]),
  /** Processed strictly in order; no timestamps. */
  actions: z.array(SimActionSchema),
})

export type WaitCondition = z.infer<typeof WaitConditionSchema>
export type SimAction = z.infer<typeof SimActionSchema>
export type QueueStrategy = z.infer<typeof QueueStrategySchema>

/** Narrowed per-kind action types, for consumers that handle one kind at a time. */
export type BuyAction = Extract<SimAction, { kind: 'buy' }>
export type BuyGeneratorAction = Extract<SimAction, { kind: 'buy_generator' }>
export type SetHighlightAction = Extract<SimAction, { kind: 'set_highlight' }>
export type SetClickRateAction = Extract<SimAction, { kind: 'set_click_rate' }>
export type WaitAction = Extract<SimAction, { kind: 'wait' }>

/**
 * Parse and structurally validate raw strategy data (the save/load trust
 * boundary). Throws a `ZodError` on malformed input. Does NOT check that
 * referenced IDs exist for the mode — call `validateStrategyForMode` for that.
 */
export function parseStrategy(raw: unknown): QueueStrategy {
  return QueueStrategySchema.parse(raw)
}

// ─── Canonical serialization (save/load round-trip stability) ─────────
//
// Emit JSON with a fixed key order and pretty-printing so that load → edit →
// save produces clean git diffs. Order is authoritative and preserved verbatim
// (no re-sort of actions); only the *key* order within each object is fixed.

function canonicalWait(until: WaitCondition): Record<string, unknown> {
  return until.kind === 'seconds'
    ? { kind: 'seconds', seconds: until.seconds }
    : { kind: 'resource_at_least', resource: until.resource, amount: until.amount }
}

function canonicalAction(action: SimAction): Record<string, unknown> {
  switch (action.kind) {
    case 'buy':
      return {
        kind: 'buy',
        upgradeId: action.upgradeId,
        ...(action.count !== undefined && { count: action.count }),
      }
    case 'buy_generator':
      return {
        kind: 'buy_generator',
        generatorId: action.generatorId,
        ...(action.count !== undefined && { count: action.count }),
      }
    case 'set_highlight':
      return { kind: 'set_highlight', highlight: action.highlight }
    case 'set_click_rate':
      return {
        kind: 'set_click_rate',
        ...(action.resource !== undefined && { resource: action.resource }),
        cps: action.cps,
      }
    case 'wait':
      return { kind: 'wait', until: canonicalWait(action.until) }
  }
}

/**
 * Serialize a strategy to canonical, pretty-printed JSON (trailing newline).
 * Key order is fixed (`version, name, mode, actions`; `kind` first per action)
 * so repeated save round-trips are byte-stable and git diffs stay minimal.
 */
export function serializeStrategy(strategy: QueueStrategy): string {
  const canonical = {
    version: strategy.version,
    name: strategy.name,
    mode: strategy.mode,
    actions: strategy.actions.map(canonicalAction),
  }
  return `${JSON.stringify(canonical, null, 2)}\n`
}

/**
 * Verify that every upgrade / generator / resource referenced by the strategy
 * exists in the given mode. Returns a list of human-readable problems (empty =
 * valid). Kept separate from the zod schema because it needs the mode.
 */
export function validateStrategyForMode(strategy: QueueStrategy, mode: ModeDefinition): string[] {
  const problems: string[] = []
  const upgradeIds = new Set(mode.upgrades.map((u) => u.id))
  const generatorIds = new Set(mode.generators.map((g) => g.id))
  const resources = new Set(mode.resources)

  strategy.actions.forEach((action, i) => {
    const at = `action ${i} (${action.kind})`
    switch (action.kind) {
      case 'buy':
        if (!upgradeIds.has(action.upgradeId))
          problems.push(`${at}: unknown upgrade "${action.upgradeId}"`)
        break
      case 'buy_generator':
        if (!generatorIds.has(action.generatorId))
          problems.push(`${at}: unknown generator "${action.generatorId}"`)
        break
      case 'set_highlight':
        if (!resources.has(action.highlight))
          problems.push(`${at}: unknown resource "${action.highlight}"`)
        break
      case 'set_click_rate':
        if (action.resource !== undefined && !resources.has(action.resource))
          problems.push(`${at}: unknown resource "${action.resource}"`)
        break
      case 'wait':
        if (action.until.kind === 'resource_at_least' && !resources.has(action.until.resource))
          problems.push(`${at}: unknown resource "${action.until.resource}"`)
        break
    }
  })

  return problems
}
