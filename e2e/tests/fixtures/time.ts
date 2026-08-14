const scale = Number(process.env.GAME_TIME_SCALE ?? 1)

if (!Number.isInteger(scale) || scale < 1 || scale > 20) {
  throw new Error('GAME_TIME_SCALE must be an integer from 1 to 20')
}

/** Convert server game-clock milliseconds to wall-clock milliseconds for test bounds. */
export function realTimeMs(gameTimeMs: number): number {
  return gameTimeMs / scale
}

/** Wall-clock test timeout with startup/assertion margin around a game duration. */
export function extendedTimeout(gameTimeMs: number, marginMs = 30_000): number {
  return realTimeMs(gameTimeMs) + marginMs
}
