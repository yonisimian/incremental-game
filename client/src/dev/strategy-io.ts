/**
 * File I/O for the Queue Simulation tab.
 *
 * Strategies are first-class JSON documents. Saving/loading uses the File System
 * Access API (`showSaveFilePicker` / `showOpenFilePicker`) where available, with
 * a download-blob + `<input type=file>` fallback for browsers without it. The
 * canonical serializer lives in `@game/shared` (`serializeStrategy`) so on-disk
 * round-trips are byte-stable; parsing goes through the shared zod boundary
 * (`parseStrategy`), which throws on malformed input.
 *
 * Reference strategies under `shared/strategies/<mode>/*.json` are bundled at
 * build time via `import.meta.glob` and listed alongside session strategies.
 */

import { parseStrategy } from '@game/shared'
import type { GameMode, QueueStrategy } from '@game/shared'

import { isAbort, JSON_TYPES, saveStrategyToFile } from '../strategy-file.js'
import type { OpenPicker } from '../strategy-file.js'

// Re-exported so the Queue tab keeps importing save from one place.
export { saveStrategyToFile }

// ─── Load ──────────────────────────────────────────────────────────────

/**
 * Prompt for a JSON file and parse it into a validated strategy. Returns `null`
 * if the user cancels. Throws (ZodError / SyntaxError) on malformed content —
 * the caller surfaces the message. Does NOT check mode compatibility.
 */
export async function loadStrategyFromFile(): Promise<QueueStrategy | null> {
  const text = await pickFileText()
  if (text === null) return null
  if (text.trim() === '') {
    throw new Error('File is empty — the export may have been interrupted; try exporting again.')
  }
  return parseStrategy(JSON.parse(text))
}

async function pickFileText(): Promise<string | null> {
  const picker = (window as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker
  if (picker) {
    try {
      const [handle] = await picker({ multiple: false, types: JSON_TYPES })
      return await (await handle.getFile()).text()
    } catch (err) {
      if (isAbort(err)) return null
      // Fall through to the input fallback on any other failure.
    }
  }
  return pickFileTextViaInput()
}

function pickFileTextViaInput(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener('cancel', () => {
      resolve(null)
    })
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      file.text().then(resolve, reject)
    })
    input.click()
  })
}

// ─── Bundled reference strategies ────────────────────────────────────────

const BUNDLED = import.meta.glob('../../../shared/strategies/**/*.json', {
  eager: true,
  import: 'default',
})

/**
 * Parsed, mode-filtered reference strategies bundled from `shared/strategies/`,
 * sorted by name. Invalid files are skipped with a warning rather than breaking
 * the panel. Each is deep-cloned so editing the copy never mutates the import.
 */
export function loadBundledStrategies(mode: GameMode): QueueStrategy[] {
  const out: QueueStrategy[] = []
  for (const [path, raw] of Object.entries(BUNDLED)) {
    try {
      const strategy = parseStrategy(raw)
      // Widen to `string`: `GameMode` is presently a single-member union, so a
      // typed `===` would be flagged as an always-true comparison.
      const strategyMode: string = strategy.mode
      if (strategyMode === mode) out.push(structuredClone(strategy))
    } catch (err) {
      console.warn(`Skipping invalid reference strategy ${path}:`, err)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
