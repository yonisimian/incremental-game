/**
 * Editor save/load — the round-trip boundary. Export serializes the working
 * tree through the shared codec; import validates an uploaded file with
 * `parseTreeFile` (the same schema the engine uses) before it becomes editable.
 *
 * Both directions also run {@link toModeDefinition} — the engine's full
 * load-time validation — so cross-node inconsistencies the zod schema can't see
 * (e.g. a prerequisite `minLevel` above the referenced upgrade's `purchaseLimit`)
 * are caught here rather than at game load.
 */

import type { BalanceFile, TreeFile } from '@game/shared'
import { parseBalanceFile, parseTreeFile, serializeTree, toModeDefinition } from '@game/shared'

/**
 * Run the engine's full load-time validation on the working tree. Throws with a
 * human-readable message on any inconsistency; returns nothing on success.
 */
function assertLoadable(tree: TreeFile): void {
  toModeDefinition(tree)
}

/** Serialize the working tree to its canonical JSON string. */
export function treeToJson(tree: TreeFile): string {
  assertLoadable(tree)
  return serializeTree(tree)
}

/** Serialize the working tree and trigger a browser download. */
export function exportTree(tree: TreeFile): void {
  assertLoadable(tree)
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
  const tree = parseTreeFile(json)
  // Then run the engine's full validation so cross-node issues (e.g. minLevel
  // above the referenced upgrade's purchaseLimit) reject the file on import.
  assertLoadable(tree)
  return tree
}

/**
 * Serialize the working balance sidecar to its canonical JSON string. Validates
 * the shape (round-trips through `parseBalanceFile`) so a malformed working copy
 * fails here rather than at the CI gate. Cross-checks against the mode's goals
 * happen at `loadBalance` time, which the gate runs.
 */
export function balanceToJson(balance: BalanceFile): string {
  return `${JSON.stringify(parseBalanceFile(balance), null, 2)}\n`
}

/** Serialize the working balance sidecar and trigger a browser download. */
export function exportBalance(balance: BalanceFile): void {
  const json = balanceToJson(balance)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${balance.mode}.json`
  a.click()
  URL.revokeObjectURL(url)
}
