/**
 * Balance sidecar loader — the dev/CI-only boundary that turns an untrusted
 * `shared/balance/<mode>.json` file into registered `BalanceEnvelope`s.
 *
 * Envelopes are development / CI metadata: the game server and gameplay client
 * never call this. Only `scripts/check-balance.ts` (the CI gate) and the dev-app
 * bootstrap load a sidecar. `loadBalance` runs **after** `loadTree` so it can
 * cross-check each envelope against the loaded mode's goals.
 */

import { getModeDefinition } from '../modes/index.js'
import type { GameMode, Goal } from '../types.js'
import { registerBalance } from './registry.js'
import { BalanceFileSchema } from './schema.js'
import type { AuthoredEnvelope, BalanceFile } from './schema.js'
import type { BalanceEnvelope } from './types.js'

/**
 * Validate an untrusted value into a typed {@link BalanceFile}. Throws a
 * `ZodError` on any malformed input. Callers pass an already-parsed JSON value.
 */
export function parseBalanceFile(json: unknown): BalanceFile {
  return BalanceFileSchema.parse(json)
}

/**
 * Attach the mode id to an authored envelope (the sidecar carries `mode` once at
 * the top level). Splits on `goalType` so the result narrows to the right
 * runtime shape (`TargetEnvelope` for timed, `PacingEnvelope` otherwise).
 */
function toEnvelope(mode: GameMode, e: AuthoredEnvelope): BalanceEnvelope {
  if (e.goalType === 'timed') {
    return {
      mode,
      goalType: e.goalType,
      checkpoints: e.checkpoints,
      minViableStrategies: e.minViableStrategies,
      maxStrategySpread: e.maxStrategySpread,
    }
  }
  return {
    mode,
    goalType: e.goalType,
    checkpoints: e.checkpoints,
    minViableStrategies: e.minViableStrategies,
    maxTimeSpread: e.maxTimeSpread,
  }
}

/**
 * Validate balance envelopes for a mode: at most one per `goalType`, each
 * constraining a goal the mode actually offers, with ordered, sane bands. The
 * envelope *values* are authored data (calibrated separately); this only rejects
 * structurally-broken envelopes so a typo fails at load rather than mid-gate.
 * Exported so the loader and its tests share one validator.
 */
export function validateEnvelopes(
  mode: string,
  goals: readonly Goal[],
  envelopes: readonly BalanceEnvelope[],
): void {
  const goalTypes = new Set(goals.map((g) => g.type))
  // Score target of a target-score goal (milestones can't sit past the finish).
  const scoreGoal = goals.find((g) => g.type === 'target-score')
  const scoreTarget = scoreGoal?.type === 'target-score' ? scoreGoal.target : undefined

  const seen = new Set<string>()
  for (const env of envelopes) {
    const where = `envelope[${env.goalType}]`

    if (seen.has(env.goalType))
      throw new Error(`[${mode}] ${where}: duplicate envelope for goalType '${env.goalType}'`)
    seen.add(env.goalType)

    if (!goalTypes.has(env.goalType))
      throw new Error(
        `[${mode}] ${where}: no '${env.goalType}' goal in this mode (envelope constrains nothing)`,
      )

    if (env.checkpoints.length === 0) throw new Error(`[${mode}] ${where}: has no checkpoints`)

    if ('maxStrategySpread' in env) {
      if (env.maxStrategySpread < 1)
        throw new Error(`[${mode}] ${where}: maxStrategySpread must be >= 1`)
      let prevTime = -Infinity
      for (const cp of env.checkpoints) {
        if (cp.minScore > cp.maxScore)
          throw new Error(
            `[${mode}] ${where} '${cp.phase}': minScore ${cp.minScore} > maxScore ${cp.maxScore}`,
          )
        if (cp.timeSec < prevTime)
          throw new Error(`[${mode}] ${where}: checkpoints must be ordered by ascending timeSec`)
        prevTime = cp.timeSec
      }
    } else {
      if (env.maxTimeSpread < 1) throw new Error(`[${mode}] ${where}: maxTimeSpread must be >= 1`)
      let prevScore = -Infinity
      for (const cp of env.checkpoints) {
        if (cp.minTimeSec > cp.maxTimeSec)
          throw new Error(
            `[${mode}] ${where} '${cp.phase}': minTimeSec ${cp.minTimeSec} > maxTimeSec ${cp.maxTimeSec}`,
          )
        if (cp.atScore !== undefined) {
          if (cp.atScore < prevScore)
            throw new Error(`[${mode}] ${where}: milestones must be ordered by ascending atScore`)
          prevScore = cp.atScore
          if (
            env.goalType === 'target-score' &&
            scoreTarget !== undefined &&
            cp.atScore > scoreTarget
          )
            throw new Error(
              `[${mode}] ${where} '${cp.phase}': atScore ${cp.atScore} exceeds the target-score goal target ${scoreTarget}`,
            )
        }
      }
    }
  }
}

/**
 * Parse, validate, and register a balance sidecar as the envelopes for its mode.
 * The mode's tree must already be loaded (`loadTree`) so envelopes can be
 * cross-checked against its goals. Returns the mode id. Throws on a malformed
 * sidecar, an unloaded mode, or an envelope for an absent goal.
 */
export function loadBalance(json: unknown): GameMode {
  const file = parseBalanceFile(json)
  const mode = file.mode as GameMode
  const def = getModeDefinition(mode)
  const envelopes = file.envelopes.map((e) => toEnvelope(mode, e))
  validateEnvelopes(mode, def.goals, envelopes)
  registerBalance(mode, envelopes)
  return mode
}
