/**
 * Dev-page bootstrap side-effect: register the bundled tree synchronously.
 *
 * The dev panel runs fully offline (no server), so instead of fetching the tree
 * like the live client does, it bundles the canonical `idler.json` (the single
 * source of truth, shared with the server) directly. This MUST run before any
 * module that calls `getModeDefinition` at evaluation time (e.g. `strategies.ts`
 * via `ui.ts`), so it lives in its own module imported first by `main.ts` —
 * imports are evaluated before the importing module's body.
 */

import { loadTree } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'

loadTree(idlerTreeFile)
