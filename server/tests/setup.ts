// Register every mode tree before any test runs. The mode registry starts empty
// at import (modes are loaded at runtime via `loadTree`), so tests that call
// `getModeDefinition` need the trees registered first.
import { loadTree } from '@game/shared'
import idlerAlternativeTreeFile from '@game/shared/trees/idler-alternative.json' with { type: 'json' }
import idlerTreeFile from '@game/shared/trees/idler.json' with { type: 'json' }

loadTree(idlerTreeFile)
loadTree(idlerAlternativeTreeFile)
