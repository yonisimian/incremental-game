// Register every mode tree + the idler balance sidecar before any test runs. The
// mode registry starts empty at import (modes are discovered at runtime from
// `shared/trees/`), so tests that call `getModeDefinition` need the trees
// registered first; the balance sidecar (`loadBalance`) then registers the idler
// envelopes, which the dev-panel envelope helpers (`envelopeFor`) depend on.
import { DEFAULT_MODE, loadBalance, loadTree } from '@game/shared'
import idlerBalanceFile from '@game/shared/balance/idler.json'

// Every tree file, like the server's discovery — default mode first, as the
// live client receives them.
const trees = import.meta.glob<unknown>('../../shared/trees/*.json', {
  eager: true,
  import: 'default',
})
const isDefault = (path: string): boolean => path.endsWith(`/${DEFAULT_MODE}.json`)
const paths = Object.keys(trees).sort(
  (a, b) => Number(isDefault(b)) - Number(isDefault(a)) || a.localeCompare(b),
)
for (const path of paths) loadTree(trees[path])
loadBalance(idlerBalanceFile)
