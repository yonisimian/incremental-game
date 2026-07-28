/**
 * Strategy file save — write a `QueueStrategy` to disk as canonical JSON. Lives
 * outside the dev bundle so the production game (the end-screen "export
 * recording" button) can reuse it without pulling in dev tooling. The dev Queue
 * tab's load path lives alongside in `dev/strategy-io.ts`.
 *
 * Prefers the File System Access API (`showSaveFilePicker`) for a native "Save
 * As" dialog with a real filename + location, and falls back to a plain download
 * when it's unavailable (Firefox/Safari) or when running inside an embedded
 * webview like VS Code's Simple Browser — there the picker *shows* but the
 * subsequent write fails, so falling through afterwards produces a second
 * prompt. We detect those webviews up front (Electron user-agent) and skip the
 * picker entirely, so no environment ever gets two prompts. Cancelling the
 * picker aborts silently — it does NOT fall through to a download.
 */

import { serializeStrategy } from '@game/shared'
import type { QueueStrategy } from '@game/shared'

// ─── Minimal File System Access API typings (not in the default DOM lib) ──

interface FsWritable {
  write(data: string): Promise<void>
  close(): Promise<void>
}
interface FsFileHandle {
  createWritable(): Promise<FsWritable>
  getFile(): Promise<File>
}
type SavePicker = (opts: {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FsFileHandle>
export type OpenPicker = (opts?: {
  multiple?: boolean
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FsFileHandle[]>

export const JSON_TYPES = [
  { description: 'Strategy JSON', accept: { 'application/json': ['.json'] } },
]

/** Whether an error is the user cancelling a File System Access picker. */
export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * Whether we're inside an embedded webview (VS Code's Simple Browser, Electron
 * apps). There the File System Access picker opens but its writes/reads fail,
 * so we must skip it and go straight to the download / `<input>` fallback. The
 * Electron user-agent token never appears in a real desktop browser, so this
 * only ever diverts genuine embedded webviews.
 */
export function isEmbeddedWebview(): boolean {
  return /\belectron\b/i.test(navigator.userAgent)
}

/** Filesystem-friendly file stem from a strategy name. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'strategy'
  )
}

/**
 * Write a strategy to disk as canonical JSON. Uses the native "Save As" picker
 * when available, else triggers a download. Resolves silently if the user
 * cancels the picker.
 */
export async function saveStrategyToFile(strategy: QueueStrategy): Promise<void> {
  const json = serializeStrategy(strategy)
  const filename = `${slugify(strategy.name)}.json`
  const picker = isEmbeddedWebview()
    ? undefined
    : (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename, types: JSON_TYPES })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      return
    } catch (err) {
      if (isAbort(err)) return // user cancelled — do not fall through
      // Picker present but blocked (e.g. embedded webview): use the download.
    }
  }
  downloadBlob(json, filename)
}

function downloadBlob(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // The anchor must be in the DOM for a programmatic click to trigger the
  // download in Firefox; Chrome tolerates a detached node but this is safe.
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer revocation: the browser reads the blob asynchronously after click(),
  // so revoking synchronously here can truncate or empty the downloaded file.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}
