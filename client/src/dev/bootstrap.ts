/**
 * Dev-page bootstrap side-effect: register every bundled tree + balance sidecar
 * synchronously.
 *
 * The dev panel runs fully offline (no server), so instead of fetching the trees
 * like the live client does, it bundles every canonical tree file (the single
 * source of truth, shared with the server) directly — see `bundled-modes.ts`. It
 * also bundles the balance sidecars — envelopes are dev/CI metadata the panel
 * reads via the balance registry, so the dev page loads them where gameplay
 * never does. This MUST run before any module that calls `getModeDefinition` at
 * evaluation time (e.g. `strategies.ts` via `ui.ts`), so it lives in its own
 * module imported first by `main.ts` — imports are evaluated before the
 * importing module's body.
 */

import { loadBalance, loadTree } from '@game/shared'
import { BUNDLED_BALANCES, BUNDLED_TREES } from './bundled-modes.js'

for (const [mode, tree] of BUNDLED_TREES) loadTree(mode, tree)
for (const balance of BUNDLED_BALANCES.values()) loadBalance(balance)
