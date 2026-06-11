/**
 * Tree-file emit script (authoring TS → JSON).
 *
 * Regenerates the committed runtime tree files from the hand-authored TS source
 * (D12). The server serves these files and both clients fetch them (D17); the
 * runtime never imports the TS authoring source.
 *
 * Run after changing a mode's authoring source:
 *   pnpm emit:trees
 *
 * The committed output is drift-guarded by a test, so a stale file fails CI.
 *
 * Usage: tsx scripts/emit-trees.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildIdlerTreeFile, serializeTree } from '@game/shared'

const ROOT = dirname(fileURLToPath(import.meta.url))
const TREES_DIR = join(ROOT, '..', 'server', 'trees')
/** Mode id → its tree file, as a pretty JSON string with a trailing newline. */
const trees: Record<string, string> = {
  idler: `${serializeTree(buildIdlerTreeFile())}\n`,
}

mkdirSync(TREES_DIR, { recursive: true })

for (const [id, json] of Object.entries(trees)) {
  const path = join(TREES_DIR, `${id}.json`)
  writeFileSync(path, json)
  console.info(`emitted ${path}`)
}
