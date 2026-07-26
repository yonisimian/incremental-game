import { z } from 'zod'

/**
 * On-disk schema version for a balance sidecar file. Bump when the shape changes
 * incompatibly. Envelopes are **development / CI metadata**, not runtime game
 * data — they live in a sidecar (`shared/balance/<mode>.json`) loaded only by the
 * dev app and the CI balance gate, never by the game server or gameplay client.
 */
export const CURRENT_BALANCE_VERSION = 1

// ─── Balance envelope schemas ────────────────────────────────────────

/**
 * A score-band checkpoint (timed goals): at `timeSec`, a viable strategy's score
 * should land within `[minScore, maxScore]`. The runtime `Checkpoint`.
 */
const ScoreCheckpointSchema = z.strictObject({
  timeSec: z.number(),
  minScore: z.number(),
  maxScore: z.number(),
  phase: z.string(),
})

/**
 * A time-band milestone (goal-terminated goals): reaching `atScore` (omitted for
 * a race, which has a single time-to-buy band) should take within
 * `[minTimeSec, maxTimeSec]`. The runtime `PacingCheckpoint`.
 */
const TimeCheckpointSchema = z.strictObject({
  atScore: z.number().optional(),
  minTimeSec: z.number(),
  maxTimeSec: z.number(),
  phase: z.string(),
})

/**
 * A balance envelope for one `goalType`. Timed goals carry a score-band
 * `TargetEnvelope`; goal-terminated goals (target-score / buy-upgrade) carry a
 * time-band `PacingEnvelope`. The `mode` is redundant with the sidecar's `mode`
 * field, so it is omitted here and injected by the loader. Ordering / cross-field
 * semantics are checked in `validateEnvelopes` (loader.ts), against the loaded
 * mode's goals.
 */
export const EnvelopeSchema = z.discriminatedUnion('goalType', [
  z.strictObject({
    goalType: z.literal('timed'),
    checkpoints: z.array(ScoreCheckpointSchema),
    minViableStrategies: z.number().int().min(0),
    maxStrategySpread: z.number(),
  }),
  z.strictObject({
    goalType: z.literal('target-score'),
    checkpoints: z.array(TimeCheckpointSchema),
    minViableStrategies: z.number().int().min(0),
    maxTimeSpread: z.number(),
  }),
  z.strictObject({
    goalType: z.literal('buy-upgrade'),
    checkpoints: z.array(TimeCheckpointSchema),
    minViableStrategies: z.number().int().min(0),
    maxTimeSpread: z.number(),
  }),
])

/**
 * The complete on-disk shape of a mode's balance sidecar: a version, the mode id
 * it applies to, and its authored envelopes (at most one per `goalType`).
 * `parseBalanceFile` (see `loader.ts`) is the single trust boundary.
 */
export const BalanceFileSchema = z.strictObject({
  version: z.literal(CURRENT_BALANCE_VERSION),
  /** Mode key (e.g. 'idler') — the envelopes apply to this loaded mode. */
  mode: z.string(),
  /**
   * Balance envelopes keyed by `goalType` (at most one per goal). The loader
   * injects `mode` when assembling the runtime `BalanceEnvelope`.
   */
  envelopes: z.array(EnvelopeSchema).default([]),
})

/** A validated balance sidecar file (inferred from {@link BalanceFileSchema}). */
export type BalanceFile = z.infer<typeof BalanceFileSchema>

/** A serializable balance envelope (inferred from its schema; carries no `mode`). */
export type AuthoredEnvelope = z.infer<typeof EnvelopeSchema>
