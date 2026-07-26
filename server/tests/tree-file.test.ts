import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { allEnvelopes, loadBalance, parseTree } from '@game/shared'

// The canonical tree files live in the shared package and are the single source
// of truth (edited via the dev-page tree editor). The server serves them
// verbatim and clients fetch them, so they must always be valid runtime trees.
// Balance sidecars (`shared/balance/*.json`) sit beside them as dev/CI metadata;
// the server never loads them at runtime, but they must stay valid + loadable.
const require = createRequire(import.meta.url)

describe('canonical tree files', () => {
  it('idler.json parses into a valid runtime tree', () => {
    const raw = readFileSync(require.resolve('@game/shared/trees/idler.json'), 'utf8')
    expect(() => parseTree(JSON.parse(raw) as unknown)).not.toThrow()
  })

  it('idler balance sidecar registers its three authored envelopes', () => {
    // The idler tree is loaded by the shared test setup; load its sidecar here.
    const raw = readFileSync(require.resolve('@game/shared/balance/idler.json'), 'utf8')
    loadBalance(JSON.parse(raw) as unknown)
    const idler = allEnvelopes()
    expect(idler.map((e) => e.goalType).sort()).toEqual(['buy-upgrade', 'target-score', 'timed'])
  })
})
