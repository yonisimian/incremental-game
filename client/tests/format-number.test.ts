import { describe, expect, it, beforeEach } from 'vitest'
import { formatNumber, setNotation, setGrouping } from '../src/ui/format-number.js'

// Reset to defaults before each test
beforeEach(() => {
  setNotation('standard')
  setGrouping('comma')
})

describe('formatNumber — standard notation', () => {
  it('formats small integers without grouping separators', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(999)).toBe('999')
  })

  it('applies comma grouping to large numbers', () => {
    expect(formatNumber(1000)).toBe('1,000')
    expect(formatNumber(1234567)).toBe('1,234,567')
  })

  it('floors by default (decimals = 0)', () => {
    expect(formatNumber(99.9)).toBe('99')
    expect(formatNumber(1234.567)).toBe('1,234')
  })

  it('respects decimals parameter', () => {
    expect(formatNumber(1234.567, 2)).toBe('1,234.57')
    expect(formatNumber(1000, 1)).toBe('1,000.0')
  })

  it('handles negative numbers', () => {
    expect(formatNumber(-5000)).toBe('-5,000')
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

  it('leaves numbers below 1000 as-is', () => {
    expect(formatNumber(500)).toBe('500')
    expect(formatNumber(0)).toBe('0')
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

  it('handles negative numbers', () => {
    expect(formatNumber(-5000)).toBe('-5K')
  })
})

describe('formatNumber — scientific notation', () => {
  beforeEach(() => {
    setNotation('scientific')
  })

  it('leaves numbers below 1000 as-is', () => {
    expect(formatNumber(500)).toBe('500')
    expect(formatNumber(0)).toBe('0')
  })

  it('formats large numbers in scientific notation', () => {
    expect(formatNumber(100000)).toBe('1e5')
    expect(formatNumber(123456)).toBe('1.23e5')
    expect(formatNumber(1000)).toBe('1e3')
  })

  it('handles negative numbers', () => {
    expect(formatNumber(-50000)).toBe('-5e4')
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
})

describe('digit grouping', () => {
  it('comma grouping', () => {
    setGrouping('comma')
    expect(formatNumber(1234567)).toBe('1,234,567')
  })

  it('period grouping with comma decimal point', () => {
    setGrouping('period')
    expect(formatNumber(1234567)).toBe('1.234.567')
    expect(formatNumber(1234.5, 1)).toBe('1.234,5')
  })

  it('space grouping (thin space)', () => {
    setGrouping('space')
    expect(formatNumber(1234567)).toBe('1\u2009234\u2009567')
  })

  it('no grouping', () => {
    setGrouping('none')
    expect(formatNumber(1234567)).toBe('1234567')
  })

  it('grouping only affects standard and name modes below 1000 threshold', () => {
    setNotation('name')
    setGrouping('comma')
    // Name mode uses grouping for numbers < 1000
    expect(formatNumber(999)).toBe('999')
    // Above 1000, name takes over
    expect(formatNumber(1500)).toBe('1.5K')
  })
})
