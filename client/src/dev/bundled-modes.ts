/**
 * Every mode's tree (and balance sidecar) bundled into the dev page at build
 * time. The dev panel runs fully offline, so instead of fetching trees from the
 * server like the live client, it globs `shared/trees/` — adding a tree file
 * adds it to the panel's tree picker, with no code change.
 */

import { DEFAULT_MODE } from '@game/shared'
import type { GameMode } from '@game/shared'

const TREE_FILES = import.meta.glob<unknown>('../../../shared/trees/*.json', {
  eager: true,
  import: 'default',
})
const BALANCE_FILES = import.meta.glob<unknown>('../../../shared/balance/*.json', {
  eager: true,
  import: 'default',
})

/** A bundled file's mode id — its file name, as in the server's discovery. */
function modeOf(path: string): GameMode {
  return path.slice(path.lastIndexOf('/') + 1, -'.json'.length)
}

/** Key files by mode, default mode first (then alphabetical) — the lobby's order. */
function byMode(files: Record<string, unknown>): ReadonlyMap<GameMode, unknown> {
  const isDefault = (mode: GameMode): number => Number(mode === DEFAULT_MODE)
  const entries = Object.entries(files).map(([path, file]) => [modeOf(path), file] as const)
  entries.sort(([a], [b]) => isDefault(b) - isDefault(a) || a.localeCompare(b))
  return new Map(entries)
}

/** Raw tree file per mode, default mode first. */
export const BUNDLED_TREES = byMode(TREE_FILES)

/** Raw balance sidecar per mode; a mode without one is absent. */
export const BUNDLED_BALANCES = byMode(BALANCE_FILES)

/** A mode's raw bundled tree file. Throws for a mode with no tree file. */
export function bundledTree(mode: GameMode): unknown {
  if (!BUNDLED_TREES.has(mode)) throw new Error(`No bundled tree for mode '${mode}'`)
  return BUNDLED_TREES.get(mode)
}
