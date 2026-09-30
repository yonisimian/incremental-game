import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODE,
  allEnvelopes,
  getModeDefinition,
  getModeFlavor,
  loadBalance,
} from '@game/shared'
import { loadTreeFiles } from '../src/trees.js'

// The canonical tree files live in the shared package and are the single source
// of truth (edited via the dev-page tree editor). Every file in `trees/` is a
// mode: the server discovers, validates, and serves them verbatim, and clients
// fetch them, so they must always be valid runtime trees. Balance sidecars
// (`shared/balance/*.json`) sit beside them as dev/CI metadata; the server never
// loads them at runtime, but they must stay valid + loadable.
const require = createRequire(import.meta.url)
const IDLER_TREE = require.resolve('@game/shared/trees/idler.json')

/** A fresh temp folder holding the given tree files (`name` → source path). */
function treeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'trees-'))
  for (const [name, source] of Object.entries(files)) copyFileSync(source, join(dir, name))
  return dir
}

describe('canonical tree files', () => {
  it('every tree file loads as a mode, default mode first', () => {
    const modes = [...loadTreeFiles().keys()]
    expect(modes[0]).toBe(DEFAULT_MODE)
    expect(modes).toContain('idler-alternative')
  })

  it('every mode has a distinct lobby display name', () => {
    const names = [...loadTreeFiles().keys()].map(
      (mode) => getModeFlavor(getModeDefinition(mode)).displayName,
    )
    expect(new Set(names).size).toBe(names.length)
  })

  it('idler balance sidecar registers its three authored envelopes', () => {
    // The idler tree is loaded by the server test setup; load its sidecar here.
    const raw = readFileSync(require.resolve('@game/shared/balance/idler.json'), 'utf8')
    loadBalance(JSON.parse(raw) as unknown)
    const idler = allEnvelopes()
    expect(idler.map((e) => e.goalType).sort()).toEqual(['buy-upgrade', 'target-score', 'timed'])
  })
})

describe('tree discovery', () => {
  it('registers each tree under its file name', () => {
    // The same content under two names is two modes — the file name is the id.
    const dir = treeDir({ 'idler.json': IDLER_TREE, 'renamed.json': IDLER_TREE })
    expect([...loadTreeFiles(dir).keys()]).toEqual(['idler', 'renamed'])
    expect(getModeDefinition('renamed')).toEqual(getModeDefinition('idler'))
  })

  it('rejects a file name that is not URL-safe', () => {
    const dir = treeDir({ 'idler.json': IDLER_TREE, 'Bad Name.json': IDLER_TREE })
    expect(() => loadTreeFiles(dir)).toThrow(/file name must be lowercase/u)
  })

  it('rejects a folder without the default mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trees-'))
    writeFileSync(join(dir, 'notes.txt'), 'not a tree')
    expect(() => loadTreeFiles(dir)).toThrow(/Default mode tree 'idler\.json' is missing/u)
  })
})
