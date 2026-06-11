/**
 * Editor save/load — the round-trip boundary. Export serializes the working
 * tree through the shared codec; import validates an uploaded file with
 * `parseTreeFile` (the same schema the engine uses) before it becomes editable.
 */

import type { TreeFile } from '@game/shared'
import { parseTreeFile, serializeTree } from '@game/shared'

/** Serialize the working tree and trigger a browser download. */
export function exportTree(tree: TreeFile): void {
  const json = serializeTree(tree)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tree.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Read + validate an uploaded tree file. Resolves with the parsed `TreeFile`,
 * or rejects with a human-readable message (bad JSON or schema violation).
 */
export async function importTreeFromFile(file: File): Promise<TreeFile> {
  const text = await file.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON.')
  }
  // parseTreeFile throws a zod error if the shape is invalid; surface its message.
  return parseTreeFile(json)
}
