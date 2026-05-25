// ─── Number Formatting ───────────────────────────────────────────────
//
// Configurable number display: notation mode + digit grouping.
// All settings are persisted to localStorage and read synchronously.

// ─── Types ───────────────────────────────────────────────────────────

/** How large numbers are abbreviated. */
export type NotationMode = 'standard' | 'name' | 'scientific' | 'engineering'

/** Thousands separator style. */
export type DigitGrouping = 'comma' | 'period' | 'space' | 'none'

interface NumberFormatSettings {
  notation: NotationMode
  grouping: DigitGrouping
}

// ─── Defaults & Persistence ──────────────────────────────────────────

const STORAGE_KEY = 'number-format'

const DEFAULTS: NumberFormatSettings = {
  notation: 'standard',
  grouping: 'comma',
}

let current: NumberFormatSettings = loadSettings()

function loadSettings(): NumberFormatSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<NumberFormatSettings>
    return {
      notation: isNotation(parsed.notation) ? parsed.notation : DEFAULTS.notation,
      grouping: isGrouping(parsed.grouping) ? parsed.grouping : DEFAULTS.grouping,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* localStorage unavailable */
  }
}

function isNotation(v: unknown): v is NotationMode {
  return v === 'standard' || v === 'name' || v === 'scientific' || v === 'engineering'
}

function isGrouping(v: unknown): v is DigitGrouping {
  return v === 'comma' || v === 'period' || v === 'space' || v === 'none'
}

// ─── Public API ──────────────────────────────────────────────────────

export function getNumberFormatSettings() {
  return current
}

export function setNotation(notation: NotationMode): void {
  current = { ...current, notation }
  saveSettings()
}

export function setGrouping(grouping: DigitGrouping): void {
  current = { ...current, grouping }
  saveSettings()
}

// ─── Name Suffixes ───────────────────────────────────────────────────

const NAME_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']

// ─── Grouping ────────────────────────────────────────────────────────

const SEPARATORS: Record<DigitGrouping, string> = {
  comma: ',',
  period: '.',
  space: '\u2009', // thin space
  none: '',
}

function applyGrouping(integerPart: string, grouping: DigitGrouping): string {
  if (grouping === 'none') return integerPart

  const sep = SEPARATORS[grouping]
  // Handle negative numbers
  const negative = integerPart.startsWith('-')
  const digits = negative ? integerPart.slice(1) : integerPart

  if (digits.length <= 3) return integerPart

  let result = ''
  let count = 0
  for (let i = digits.length - 1; i >= 0; i--) {
    if (count > 0 && count % 3 === 0) result = sep + result
    result = digits[i] + result
    count++
  }

  return negative ? `-${result}` : result
}

// ─── Core Formatter ──────────────────────────────────────────────────

/**
 * Format a number for display according to current settings.
 *
 * @param value - The number to format.
 * @param decimals - Max decimal places for standard/name mode (default: 0).
 */
export function formatNumber(value: number, decimals = 0): string {
  const { notation, grouping } = current

  if (!isFinite(value)) return String(value)

  switch (notation) {
    case 'standard':
      return formatStandard(value, decimals, grouping)
    case 'name':
      return formatName(value, grouping)
    case 'scientific':
      return formatScientific(value)
    case 'engineering':
      return formatEngineering(value)
  }
}

function formatStandard(value: number, decimals: number, grouping: DigitGrouping): string {
  const rounded = decimals > 0 ? Number(value.toFixed(decimals)) : Math.floor(value)
  const str = decimals > 0 ? rounded.toFixed(decimals) : String(rounded)

  const [intPart, fracPart] = str.split('.')
  const grouped = applyGrouping(intPart, grouping)

  if (fracPart) {
    // Use opposite separator as decimal point when grouping uses period
    const decimalPoint = grouping === 'period' ? ',' : '.'
    return grouped + decimalPoint + fracPart
  }
  return grouped
}

function formatName(value: number, grouping: DigitGrouping): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs < 1000) {
    return sign + applyGrouping(String(Math.floor(abs)), grouping)
  }

  // Find the appropriate suffix tier
  const tier = Math.min(Math.floor(Math.log10(abs) / 3), NAME_SUFFIXES.length - 1)
  const scaled = abs / Math.pow(1000, tier)

  // Show up to 2 decimal places, trim trailing zeros
  let numStr: string
  if (scaled >= 100) {
    numStr = Math.floor(scaled).toString()
  } else if (scaled >= 10) {
    numStr = scaled.toFixed(1).replace(/\.0$/, '')
  } else {
    numStr = scaled.toFixed(2).replace(/\.?0+$/, '')
  }

  return sign + numStr + NAME_SUFFIXES[tier]
}

function formatScientific(value: number): string {
  if (value === 0) return '0'

  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs < 1000) return sign + String(Math.floor(abs))

  const exp = Math.floor(Math.log10(abs))
  const mantissa = abs / Math.pow(10, exp)
  const mantissaStr = mantissa.toFixed(2).replace(/\.?0+$/, '')

  return `${sign}${mantissaStr}e${exp}`
}

function formatEngineering(value: number): string {
  if (value === 0) return '0'

  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs < 1000) return sign + String(Math.floor(abs))

  const exp = Math.floor(Math.log10(abs))
  const engExp = exp - (exp % 3) // Round down to multiple of 3
  const mantissa = abs / Math.pow(10, engExp)
  const mantissaStr = mantissa.toFixed(2).replace(/\.?0+$/, '')

  return `${sign}${mantissaStr}e${engExp}`
}
