// ─── Number Formatting ───────────────────────────────────────────────
//
// Configurable number display: notation mode + decimal separator.
// All settings are persisted to localStorage and read synchronously.

// ─── Types ───────────────────────────────────────────────────────────

/** How large numbers are abbreviated. */
export type NotationMode = 'name' | 'scientific' | 'engineering'

/** Decimal mark used for the fractional part (locale preference). */
export type DecimalSeparator = 'period' | 'comma'

interface NumberFormatSettings {
  notation: NotationMode
  decimalSeparator: DecimalSeparator
}

// ─── Defaults & Persistence ──────────────────────────────────────────

const STORAGE_KEY = 'number-format'

const DEFAULTS: NumberFormatSettings = {
  notation: 'scientific',
  decimalSeparator: 'period',
}

let current: NumberFormatSettings = loadSettings()

function loadSettings(): NumberFormatSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const migrated = migrateSettings(JSON.parse(raw))
    // LEGACY MIGRATION (remove before release): rewrite the canonical shape
    // back when the stored blob differs (legacy `standard`/`grouping` keys,
    // extra fields). This purges stale data so the migration can eventually be
    // removed. On removal, replace the two lines below with a direct return of
    // `migrated` and inline field validation here.
    const canonical = JSON.stringify(migrated)
    if (canonical !== raw) writeSettings(canonical)
    return migrated
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * LEGACY MIGRATION (remove before release).
 *
 * Normalize a persisted settings blob into current-schema settings, migrating
 * legacy shapes from before the standard-notation removal / grouping rework:
 *
 *  - `notation: 'standard'` (removed) falls back to the default (scientific).
 *  - The old four-way `grouping` field is mapped to `decimalSeparator`: only
 *    `'period'` grouping rendered a comma decimal mark, so it becomes `'comma'`;
 *    every other grouping used a dot, so it becomes `'period'`.
 *
 * Once released clients have re-persisted the canonical shape (see the
 * write-back in `loadSettings`), delete this function and its callers.
 */
export function migrateSettings(parsed: unknown): NumberFormatSettings {
  const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >

  const notation = isNotation(obj.notation) ? obj.notation : DEFAULTS.notation

  let decimalSeparator: DecimalSeparator
  if (isDecimalSeparator(obj.decimalSeparator)) {
    decimalSeparator = obj.decimalSeparator
  } else if (obj.grouping !== undefined) {
    // Legacy grouping field: 'period' meant a comma decimal mark.
    decimalSeparator = obj.grouping === 'period' ? 'comma' : 'period'
  } else {
    decimalSeparator = DEFAULTS.decimalSeparator
  }

  return { notation, decimalSeparator }
}

function saveSettings(): void {
  writeSettings(JSON.stringify(current))
}

function writeSettings(serialized: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    /* localStorage unavailable */
  }
}

function isNotation(v: unknown): v is NotationMode {
  return v === 'name' || v === 'scientific' || v === 'engineering'
}

function isDecimalSeparator(v: unknown): v is DecimalSeparator {
  return v === 'period' || v === 'comma'
}

// ─── Public API ──────────────────────────────────────────────────────

export function getNumberFormatSettings() {
  return current
}

export function setNotation(notation: NotationMode): void {
  current = { ...current, notation }
  saveSettings()
}

export function setDecimalSeparator(decimalSeparator: DecimalSeparator): void {
  current = { ...current, decimalSeparator }
  saveSettings()
}

// ─── Name Suffixes ───────────────────────────────────────────────────
//
// Tiers 0–10 use the traditional fixed abbreviations. Everything above is
// generated from Conway–Wechsler short-scale roots: each "illion" name is a
// combination of ones/tens/hundreds components, so three small arrays cover
// tiers up to 1e2997 — far beyond what a JS double (~1.8e308) can represent.

const SMALL_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No']

// Latin roots for the illion index (decillion = 10th illion, index 10 onward).
const ONES = ['', 'U', 'D', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No']
const TENS = ['', 'Dc', 'Vg', 'Tg', 'Qd', 'Qq', 'Sg', 'St', 'Og', 'Ng']
const HUNDREDS = ['', 'Ce', 'Dn', 'Tc', 'Qe', 'Qu', 'Se', 'Si', 'Ot', 'Ne']

/**
 * Abbreviated suffix for a power-of-1000 tier (tier 1 = "K", tier 2 = "M", …).
 * Returns null past the generator's range (tier ≥ 1000, i.e. ≥ 1e3000), which
 * is unreachable for finite doubles but guards against emitting garbage.
 */
function nameSuffix(tier: number): string | null {
  if (tier < SMALL_SUFFIXES.length) return SMALL_SUFFIXES[tier]
  if (tier >= 1000) return null

  const illion = tier - 1
  return (
    ONES[illion % 10] + TENS[Math.floor(illion / 10) % 10] + HUNDREDS[Math.floor(illion / 100) % 10]
  )
}

// ─── Decimal Separator ───────────────────────────────────────────────

/**
 * Swap the decimal mark of an already-formatted number to match the requested
 * preference. Numbers carry at most one '.', so a single replace suffices
 * (suffix letters and the exponent 'e' contain no dot).
 */
function applyDecimalSeparator(formatted: string, separator: DecimalSeparator): string {
  return separator === 'comma' ? formatted.replace('.', ',') : formatted
}

// ─── Core Formatter ──────────────────────────────────────────────────

/**
 * Format a number for display according to the current settings.
 *
 * @param value - The number to format.
 * @param decimals - Max decimal places for name mode values below 1000 (default: 0).
 */
export function formatNumber(value: number, decimals = 0): string {
  return formatNumberAs(value, current.notation, current.decimalSeparator, decimals)
}

/**
 * Format a small value without losing its fractional part.
 *
 * Every notation floors below 1000 (abbreviation only kicks in above it), which
 * is right for stockpiles but wrong for the numbers whose decimals *are* the
 * information — multipliers, per-unit rates. This keeps up to `maxDecimals`
 * places (trailing zeros trimmed) under 1000 and defers to the configured
 * notation above it.
 */
export function formatDecimal(value: number, maxDecimals = 2): string {
  if (!isFinite(value)) return String(value)
  if (Math.abs(value) >= 1000) return formatNumber(value)
  const text = value.toFixed(maxDecimals).replace(/\.?0+$/, '')
  return applyDecimalSeparator(text, current.decimalSeparator)
}

/** Format a multiplier (`1.25`, `3`) — {@link formatDecimal} at two places. */
export function formatMultiplier(value: number): string {
  return formatDecimal(value, 2)
}

/**
 * Format a number in an explicit notation / decimal separator, independent of
 * the persisted settings. Used to render settings previews that show the same
 * value across every notation without mutating global state.
 */
export function formatNumberAs(
  value: number,
  notation: NotationMode,
  decimalSeparator: DecimalSeparator,
  decimals = 0,
): string {
  if (!isFinite(value)) return String(value)

  return applyDecimalSeparator(formatWithNotation(value, notation, decimals), decimalSeparator)
}

/** Render the number in the given notation, without applying the decimal separator. */
function formatWithNotation(value: number, notation: NotationMode, decimals: number): string {
  switch (notation) {
    case 'name':
      return formatName(value, decimals)
    case 'scientific':
      return formatScientific(value)
    case 'engineering':
      return formatEngineering(value)
    default:
      return assertNever(notation)
  }
}

function formatName(value: number, decimals: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs < 1000) {
    const rounded = decimals > 0 ? Number(abs.toFixed(decimals)) : Math.floor(abs)
    return sign + (decimals > 0 ? rounded.toFixed(decimals) : String(rounded))
  }

  // Find the appropriate suffix tier
  const tier = Math.floor(Math.log10(abs) / 3)
  const suffix = nameSuffix(tier)
  // Past the nameable range, fall back to scientific rather than emitting a
  // broken mantissa+suffix hybrid (unreachable for finite doubles).
  if (suffix === null) return sign + formatScientific(abs)

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

  return sign + numStr + suffix
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

/** Compile-time exhaustiveness guard: unreachable unless a notation is unhandled. */
function assertNever(value: never): never {
  throw new Error(`Unhandled notation: ${String(value)}`)
}
