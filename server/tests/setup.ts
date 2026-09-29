// Register every mode tree before any test runs. The mode registry starts empty
// at import (modes are discovered at runtime from `shared/trees/`), so tests
// that call `getModeDefinition` need the trees registered first.
import { loadTreeFiles } from '../src/trees.js'

loadTreeFiles()
