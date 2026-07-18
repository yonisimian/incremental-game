// Register the idler tree + balance sidecar before any test runs. The mode
// registry starts empty at import (modes are loaded at runtime via `loadTree`),
// so tests that call `getModeDefinition` need the tree registered first; the
// balance sidecar (`loadBalance`) then registers the mode's envelopes, which
// tests that call `envelopeFor` / `allEnvelopes` depend on.
import { loadBalance, loadTree } from '../src/index.js'
import idlerBalanceFile from '../balance/idler.json' with { type: 'json' }
import idlerTreeFile from '../trees/idler.json' with { type: 'json' }

loadTree(idlerTreeFile)
loadBalance(idlerBalanceFile)
