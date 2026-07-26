/**
 * Strategy file save — write a `QueueStrategy` to disk as canonical JSON.
 *
 * Uses the File System Access API (`showSaveFilePicker`) where available, with a
 * download-blob fallback. Lives outside the dev bundle so the production game
 * (the end-screen "export recording" button) can reuse it without pulling in
 * dev tooling. The dev Queue tab's load path reuses the shared helpers here.
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

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
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
 * Write a strategy to disk as canonical JSON. Uses the File System Access
 * picker when available, else triggers a download. Resolves silently if the
 * user cancels the picker.
 */
export async function saveStrategyToFile(strategy: QueueStrategy): Promise<void> {
  const json = serializeStrategy(strategy)
  const suggestedName = `${slugify(strategy.name)}.json`
  const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: JSON_TYPES })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      return
    } catch (err) {
      if (isAbort(err)) return // user cancelled — nothing to do
      // Any other failure: fall through to the download fallback.
    }
  }
  downloadBlob(json, suggestedName)
}

function downloadBlob(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
