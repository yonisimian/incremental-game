// Register every mode tree + the idler balance sidecar before any test runs. The
// mode registry starts empty at import (modes are discovered at runtime from
// `shared/trees/`), so tests that call `getModeDefinition` need the trees
// registered first; the balance sidecar (`loadBalance`) then registers the idler
// envelopes, which the dev-panel envelope helpers (`envelopeFor`) depend on.
import { loadBalance, loadTree } from '@game/shared'
import idlerBalanceFile from '@game/shared/balance/idler.json'
// Every tree file, keyed by file name — default mode first, as the live client
// receives them.
import { BUNDLED_TREES } from '../src/dev/bundled-modes.js'

for (const [mode, tree] of BUNDLED_TREES) loadTree(mode, tree)
loadBalance(idlerBalanceFile)
