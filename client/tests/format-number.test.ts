import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  formatMultiplier,
  formatNumber,
  formatNumberAs,
  setNotation,
  setDecimalSeparator,
  migrateSettings,
} from '../src/ui/format-number.js'

// Reset to defaults before each test
beforeEach(() => {
  setNotation('scientific')
  setDecimalSeparator('period')
})

describe('formatNumber — scientific notation', () => {
  it('leaves numbers below 1000 as-is', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(500)).toBe('500')
  })

  it('formats large numbers in scientific notation', () => {
    expect(formatNumber(100000)).toBe('1e5')
    expect(formatNumber(123456)).toBe('1.23e5')
    expect(formatNumber(1000)).toBe('1e3')
  })

  it('handles negative numbers', () => {
    expect(formatNumber(-50000)).toBe('-5e4')
  })

  it('formats very large numbers around 1e67 compactly', () => {
    expect(formatNumber(1e67)).toBe('1e67')
    expect(formatNumber(9.99e67)).toBe('9.99e67')
  })

  it('handles Infinity and NaN', () => {
    expect(formatNumber(Infinity)).toBe('Infinity')
    expect(formatNumber(NaN)).toBe('NaN')
  })
})

describe('formatNumber — name notation', () => {
  beforeEach(() => {
    setNotation('name')
  })

  it('floors numbers below 1000 by default', () => {
    expect(formatNumber(500)).toBe('500')
    expect(formatNumber(0)).toBe('0')
  })

  it('respects decimals parameter for numbers below 1000', () => {
    expect(formatNumber(999.567, 2)).toBe('999.57')
    expect(formatNumber(12.3, 1)).toBe('12.3')
  })

  it('abbreviates thousands as K', () => {
    expect(formatNumber(1500)).toBe('1.5K')
    expect(formatNumber(12345)).toBe('12.3K')
    expect(formatNumber(123456)).toBe('123K')
  })

  it('abbreviates millions as M', () => {
    expect(formatNumber(1_000_000)).toBe('1M')
    expect(formatNumber(2_500_000)).toBe('2.5M')
  })

  it('abbreviates billions as B', () => {
    expect(formatNumber(1_000_000_000)).toBe('1B')
  })

  it('uses the highest small-scale suffix (No) then switches to generated names', () => {
    expect(formatNumber(1e30)).toBe('1No')
    expect(formatNumber(1e33)).toBe('1Dc')
  })

  it('generates suffixes far beyond the traditional range', () => {
    expect(formatNumber(1.5e36)).toBe('1.5UDc')
    expect(formatNumber(1e40)).toBe('10DDc')
    expect(formatNumber(1e63)).toBe('1Vg')
  })

  it('abbreviates very large numbers around 1e67', () => {
    expect(formatNumber(1e67)).toBe('10UVg')
    expect(formatNumber(9.99e67)).toBe('99.9UVg')
  })

  it('names numbers up to the top of the double range', () => {
    expect(formatNumber(1e93)).toBe('1Tg')
    expect(formatNumber(1e100)).toBe('10DTg')
    expect(formatNumber(1e150)).toBe('1NoQd')
    // ~1.8e308 is the largest finite double; it must stay named, not raw.
    expect(formatNumber(1.7e308)).toBe('170UCe')
  })

  it('handles negative numbers', () => {
    expect(formatNumber(-5000)).toBe('-5K')
  })
})

describe('formatNumber — engineering notation', () => {
  beforeEach(() => {
    setNotation('engineering')
  })

  it('leaves numbers below 1000 as-is', () => {
    expect(formatNumber(500)).toBe('500')
    expect(formatNumber(0)).toBe('0')
  })

  it('uses exponents that are multiples of 3', () => {
    expect(formatNumber(1000)).toBe('1e3')
    expect(formatNumber(12345)).toBe('12.35e3')
    expect(formatNumber(123456)).toBe('123.46e3')
    expect(formatNumber(1234567)).toBe('1.23e6')
  })

  it('handles negative numbers', () => {
    expect(formatNumber(-5000)).toBe('-5e3')
  })

  it('formats very large numbers around 1e67 with exponent multiple of 3', () => {
    expect(formatNumber(1e67)).toBe('10e66')
    expect(formatNumber(9.99e67)).toBe('99.9e66')
  })
})

describe('decimal separator', () => {
  it('defaults to a period across all notations', () => {
    setNotation('scientific')
    expect(formatNumber(123456)).toBe('1.23e5')
    setNotation('engineering')
    expect(formatNumber(123456)).toBe('123.46e3')
    setNotation('name')
    expect(formatNumber(1500)).toBe('1.5K')
  })

  it('applies comma to the scientific mantissa', () => {
    setNotation('scientific')
    setDecimalSeparator('comma')
    expect(formatNumber(123456)).toBe('1,23e5')
  })

  it('applies comma to the engineering mantissa', () => {
    setNotation('engineering')
    setDecimalSeparator('comma')
    expect(formatNumber(123456)).toBe('123,46e3')
  })

  it('applies comma to name-notation values', () => {
    setNotation('name')
    setDecimalSeparator('comma')
    expect(formatNumber(1500)).toBe('1,5K')
    expect(formatNumber(1.5e36)).toBe('1,5UDc')
    expect(formatNumber(999.5, 1)).toBe('999,5')
  })

  it('leaves integers untouched regardless of separator', () => {
    setDecimalSeparator('comma')
    setNotation('name')
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(1000)).toBe('1K')
    setNotation('scientific')
    expect(formatNumber(100000)).toBe('1e5')
  })
})

describe('formatNumberAs — explicit notation/separator (settings preview)', () => {
  // The settings modal formats one sample value across every notation so the
  // examples and preview always agree; lock that behavior here.
  const SAMPLE = 15_500_000

  it('renders the same value across notations with a period separator', () => {
    expect(formatNumberAs(SAMPLE, 'name', 'period')).toBe('15.5M')
    expect(formatNumberAs(SAMPLE, 'scientific', 'period')).toBe('1.55e7')
    expect(formatNumberAs(SAMPLE, 'engineering', 'period')).toBe('15.5e6')
  })

  it('surfaces the comma separator in every notation', () => {
    expect(formatNumberAs(SAMPLE, 'name', 'comma')).toBe('15,5M')
    expect(formatNumberAs(SAMPLE, 'scientific', 'comma')).toBe('1,55e7')
    expect(formatNumberAs(SAMPLE, 'engineering', 'comma')).toBe('15,5e6')
  })

  it('ignores the persisted settings', () => {
    setNotation('scientific')
    setDecimalSeparator('period')
    // Explicit args win regardless of the current global settings.
    expect(formatNumberAs(SAMPLE, 'name', 'comma')).toBe('15,5M')
  })
})

// LEGACY MIGRATION tests (remove before release, alongside migrateSettings).
describe('migrateSettings', () => {
  it('maps the removed standard notation to the default', () => {
    expect(migrateSettings({ notation: 'standard' })).toEqual({
      notation: 'scientific',
      decimalSeparator: 'period',
    })
  })

  it('preserves still-valid notation modes', () => {
    expect(migrateSettings({ notation: 'name' }).notation).toBe('name')
    expect(migrateSettings({ notation: 'engineering' }).notation).toBe('engineering')
  })

  it('maps legacy period grouping to a comma decimal separator', () => {
    expect(migrateSettings({ notation: 'name', grouping: 'period' })).toEqual({
      notation: 'name',
      decimalSeparator: 'comma',
    })
  })

  it('maps other legacy groupings to a period decimal separator', () => {
    for (const grouping of ['comma', 'space', 'none']) {
      expect(migrateSettings({ grouping }).decimalSeparator).toBe('period')
    }
  })

  it('keeps an explicit decimalSeparator over a legacy grouping field', () => {
    expect(migrateSettings({ decimalSeparator: 'comma', grouping: 'comma' }).decimalSeparator).toBe(
      'comma',
    )
  })

  it('falls back to defaults for missing or malformed input', () => {
    expect(migrateSettings(null)).toEqual({ notation: 'scientific', decimalSeparator: 'period' })
    expect(migrateSettings({})).toEqual({ notation: 'scientific', decimalSeparator: 'period' })
    expect(migrateSettings({ notation: 42, decimalSeparator: 'nonsense' })).toEqual({
      notation: 'scientific',
      decimalSeparator: 'period',
    })
  })
})

// LEGACY MIGRATION tests (remove before release, alongside the write-back).
describe('legacy settings write-back', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('rewrites the canonical shape back, purging legacy keys on load', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ notation: 'standard', grouping: 'period' }),
      setItem,
    })
    // Fresh module instance so its top-level loadSettings() runs with the stub.
    vi.resetModules()
    await import('../src/ui/format-number.js')

    expect(setItem).toHaveBeenCalledTimes(1)
    const [key, value] = setItem.mock.calls[0] as [string, string]
    expect(key).toBe('number-format')
    expect(JSON.parse(value)).toEqual({ notation: 'scientific', decimalSeparator: 'comma' })
    expect(value).not.toContain('standard')
    expect(value).not.toContain('grouping')
  })

  it('does not rewrite when the stored blob is already canonical', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ notation: 'scientific', decimalSeparator: 'period' }),
      setItem,
    })
    vi.resetModules()
    await import('../src/ui/format-number.js')

    expect(setItem).not.toHaveBeenCalled()
  })
})

describe('formatMultiplier', () => {
  // Every notation floors sub-1000 values, which would render every bonus as a
  // flat "1" — the reason multipliers bypass notation entirely down there.
  it('keeps the fractional part that notation would floor away', () => {
    for (const notation of ['scientific', 'engineering', 'name'] as const) {
      setNotation(notation)
      expect(formatMultiplier(1.25)).toBe('1.25')
      expect(formatMultiplier(1.4285714)).toBe('1.43')
    }
  })

  it('trims trailing zeros so a whole multiplier reads as one', () => {
    expect(formatMultiplier(3)).toBe('3')
    expect(formatMultiplier(1.5)).toBe('1.5')
    expect(formatMultiplier(1.001)).toBe('1')
  })

  it('honours the decimal-separator preference', () => {
    setDecimalSeparator('comma')
    expect(formatMultiplier(1.25)).toBe('1,25')
  })

  it('falls back to the configured notation once large', () => {
    setNotation('scientific')
    expect(formatMultiplier(12345)).toBe('1.23e4')
  })
})
