// ─── Audio Settings ──────────────────────────────────────────────────
//
// Music and sound-effect volumes (0–100), persisted to localStorage and read
// synchronously. Nothing plays sound yet — these are stored so the settings UI
// is in place for when audio lands.

export interface AudioSettings {
  readonly music: number
  readonly sfx: number
}

const STORAGE_KEY = 'audio-settings'
const DEFAULT: AudioSettings = { music: 70, sfx: 80 }

let current: AudioSettings = loadSettings()

/** Clamp to a whole percentage; anything non-numeric falls back to `fallback`. */
function toVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.round(Math.min(100, Math.max(0, v)))
}

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>> | null
    return {
      music: toVolume(parsed?.music, DEFAULT.music),
      sfx: toVolume(parsed?.sfx, DEFAULT.sfx),
    }
  } catch {
    return DEFAULT
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* localStorage unavailable */
  }
}

export function getAudioSettings(): AudioSettings {
  return current
}

export function setMusicVolume(volume: number): void {
  current = { ...current, music: toVolume(volume, current.music) }
  saveSettings()
}

export function setSfxVolume(volume: number): void {
  current = { ...current, sfx: toVolume(volume, current.sfx) }
  saveSettings()
}
