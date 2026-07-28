const DEFAULT_GAME_TIME_SCALE = 1
export const MAX_GAME_TIME_SCALE = 20

/** Parse the optional server clock multiplier used by accelerated E2E runs. */
export function parseGameTimeScale(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_GAME_TIME_SCALE
  const scale = Number(raw)
  if (!Number.isInteger(scale) || scale < 1 || scale > MAX_GAME_TIME_SCALE) {
    throw new Error(`GAME_TIME_SCALE must be an integer from 1 to ${MAX_GAME_TIME_SCALE}`)
  }
  return scale
}

/** Game-time multiplier. Production defaults to 1; extended E2E runs use 20. */
export const GAME_TIME_SCALE = parseGameTimeScale(process.env.GAME_TIME_SCALE)

/** Convert a game-clock delay to the corresponding real wall-clock delay. */
export function realTimeDelay(gameTimeMs: number): number {
  return gameTimeMs / GAME_TIME_SCALE
}

/** Convert real monotonic elapsed time to elapsed game seconds. */
export function elapsedGameSeconds(realTimeMs: number): number {
  return (realTimeMs * GAME_TIME_SCALE) / 1000
}
