import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { DEFAULT_MODE, loadTree, parseTreeFile } from '@game/shared'
import type { GameMode } from '@game/shared'

// ─── Mode trees (discovered from disk) ───────────────────────────────
//
// Every `<mode>.json` in the shared package's `trees/` folder is a mode: adding
// a mode is adding a file. The folder is resolved through the package itself
// (works from both `tsx` in dev and `node dist` in prod).

/** Mode ids double as URL path segments (`/trees/<mode>.json`). */
const MODE_ID_PATTERN = /^[a-z0-9-]+$/u

const require = createRequire(import.meta.url)
const TREES_DIR = join(dirname(require.resolve('@game/shared/package.json')), 'trees')

/**
 * Read, validate, and register every tree file. Returns each mode's raw bytes
 * keyed by mode id, default mode first (then alphabetical) — the order clients
 * load them in, and so the lobby picker's order. Throws on a malformed tree, a
 * file whose name and `id` disagree, or a missing default mode. `dir` is
 * overridable for tests.
 */
export function loadTreeFiles(dir = TREES_DIR): Map<GameMode, string> {
  const modes = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort((a, b) => Number(a !== DEFAULT_MODE) - Number(b !== DEFAULT_MODE) || a.localeCompare(b))

  const rawTrees = new Map<GameMode, string>()
  for (const mode of modes) {
    if (!MODE_ID_PATTERN.test(mode)) {
      throw new Error(`Tree file '${mode}.json': file name must be lowercase a-z, 0-9 and '-'`)
    }
    const raw = readFileSync(join(dir, `${mode}.json`), 'utf8')
    const json = JSON.parse(raw) as unknown
    // Check before registering, so a mismatched file can't overwrite another mode.
    const { id } = parseTreeFile(json)
    if (id !== mode) {
      throw new Error(
        `Tree file '${mode}.json' declares id '${id}' — the id must match the file name`,
      )
    }
    loadTree(json)
    rawTrees.set(mode, raw)
  }
  if (!rawTrees.has(DEFAULT_MODE)) {
    throw new Error(`Default mode tree '${DEFAULT_MODE}.json' is missing from ${dir}`)
  }
  return rawTrees
}
