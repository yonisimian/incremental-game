// Register every mode tree + the idler balance sidecar before any test runs. The
// mode registry starts empty at import (modes are loaded at runtime via
// `loadTree`), so tests that call `getModeDefinition` need the trees registered
// first; the balance sidecar (`loadBalance`) then registers the idler envelopes,
// which the dev-panel envelope helpers (`envelopeFor`) depend on.
import { loadBalance, loadTree } from '@game/shared'
import idlerBalanceFile from '@game/shared/balance/idler.json'
import idlerAlternativeTreeFile from '@game/shared/trees/idler-alternative.json'
import idlerTreeFile from '@game/shared/trees/idler.json'

loadTree(idlerTreeFile)
loadTree(idlerAlternativeTreeFile)
loadBalance(idlerBalanceFile)
