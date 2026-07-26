// Register the idler tree + balance sidecar before any test runs. The mode
// registry starts empty at import (modes are loaded at runtime via `loadTree`),
// so tests that call `getModeDefinition` need the tree registered first; the
// balance sidecar (`loadBalance`) then registers the mode's envelopes, which the
// dev-panel envelope helpers (`envelopeFor`) depend on.
import { loadBalance, loadTree } from '@game/shared'
import idlerBalanceFile from '@game/shared/balance/idler.json'
import idlerTreeFile from '@game/shared/trees/idler.json'

loadTree(idlerTreeFile)
loadBalance(idlerBalanceFile)
