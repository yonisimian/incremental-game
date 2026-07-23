import { describe, expect, it, beforeEach } from 'vitest'
import { formatNumber, setNotation, setGrouping } from '../src/ui/format-number.js'

// Reset to defaults before each test
beforeEach(() => {
  setNotation('scientific')
  setGrouping('comma')
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

describe('digit grouping', () => {
  it('comma grouping', () => {
    setNotation('name')
    setGrouping('comma')
    expect(formatNumber(999.5, 1)).toBe('999.5')
  })

  it('period grouping swaps decimal point to comma below 1000 in name mode', () => {
    setNotation('name')
    setGrouping('period')
    expect(formatNumber(999.5, 1)).toBe('999,5')
  })

  it('space grouping keeps decimal point as dot', () => {
    setNotation('name')
    setGrouping('space')
    expect(formatNumber(999.5, 1)).toBe('999.5')
  })

  it('no grouping keeps decimal point as dot', () => {
    setNotation('name')
    setGrouping('none')
    expect(formatNumber(999.5, 1)).toBe('999.5')
  })

  it('grouping does not affect scientific notation', () => {
    setNotation('scientific')
    setGrouping('period')
    expect(formatNumber(123456)).toBe('1.23e5')
  })

  it('grouping only affects name mode below 1000 threshold', () => {
    setNotation('name')
    setGrouping('period')
    expect(formatNumber(999.5, 1)).toBe('999,5')
    // Above 1000, name takes over
    expect(formatNumber(1500)).toBe('1.5K')
  })
})
