import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseTree } from '@game/shared'

// The canonical tree files live in the shared package and are the single source
// of truth (edited via the dev-page tree editor). The server serves them
// verbatim and clients fetch them, so they must always be valid runtime trees.
const require = createRequire(import.meta.url)

describe('canonical tree files', () => {
  it('idler.json parses into a valid runtime tree', () => {
    const raw = readFileSync(require.resolve('@game/shared/trees/idler.json'), 'utf8')
    expect(() => parseTree(JSON.parse(raw) as unknown)).not.toThrow()
  })
})
