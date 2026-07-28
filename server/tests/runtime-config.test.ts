import { describe, expect, it } from 'vitest'
import { MAX_GAME_TIME_SCALE, parseGameTimeScale } from '../src/runtime-config.js'

describe('server runtime config', () => {
  it('defaults game time to production speed', () => {
    expect(parseGameTimeScale(undefined)).toBe(1)
    expect(parseGameTimeScale('')).toBe(1)
  })

  it('accepts integer scales through the supported cap', () => {
    expect(parseGameTimeScale('1')).toBe(1)
    expect(parseGameTimeScale(String(MAX_GAME_TIME_SCALE))).toBe(MAX_GAME_TIME_SCALE)
  })

  it.each(['0', '-1', '1.5', 'not-a-number', String(MAX_GAME_TIME_SCALE + 1)])(
    'rejects invalid scale %s',
    (raw) => {
      expect(() => parseGameTimeScale(raw)).toThrow(
        `GAME_TIME_SCALE must be an integer from 1 to ${MAX_GAME_TIME_SCALE}`,
      )
    },
  )
})
