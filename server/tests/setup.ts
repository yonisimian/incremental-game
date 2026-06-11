// Register the idler tree before any test runs. The mode registry starts empty
// at import (modes are loaded at runtime via `loadTree`), so tests that call
// `getModeDefinition` need the tree registered first.
import { buildIdlerTreeFile, loadTree } from '@game/shared'

loadTree(buildIdlerTreeFile())
