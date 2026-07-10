// @game/shared — pure single-step action applier for the strategy simulator.
//
// `applySimAction` applies ONE game action (a single upgrade level, a single
// generator unit, or a highlight switch) to a player state, reusing the same
// validators and mutators the server uses so the two can't drift. It does NOT
// expand `count` (the engine does that, one blocking unit at a time) and does
// NOT handle `set_click_rate` / `wait` (those are engine orchestration, not
// state mutations — the server has no such actions).
//
// The result tells the engine what to do next:
//   - applied:   the action fired; advance.
//   - transient: valid target but unaffordable right now — keep waiting (income
//                may make it affordable later).
//   - permanent: structurally impossible (maxed / choice-group closed /
//                prerequisite unmet / locked / unknown) — give up and report;
//                more time won't help.

import { applyGeneratorPurchase } from '../generators.js'
import { applyPurchase } from '../modes/index.js'
import type { ModeDefinition } from '../modes/types.js'
import { generatorBlockReason, purchaseBlockReason } from '../purchase-validation.js'
import type { PlayerState, UpgradeDefinition } from '../types.js'
import type { BuyAction, BuyGeneratorAction, SetHighlightAction } from './strategy.js'

/** A game action that mutates player state (excludes the engine-only kinds). */
export type GameAction = BuyAction | BuyGeneratorAction | SetHighlightAction

export type SimApplyResult =
  | { status: 'applied' }
  | { status: 'transient'; reason: 'unaffordable' }
  | { status: 'permanent'; reason: string }

/** `unaffordable` is the sole transient block; every other reason is permanent. */
function classify(reason: string): SimApplyResult {
  return reason === 'unaffordable'
    ? { status: 'transient', reason: 'unaffordable' }
    : { status: 'permanent', reason }
}

/**
 * Apply a single game action to `state` (mutating it). `upgradeMap` is the mode's
 * upgrade lookup (passed in so the engine builds it once, matching the server).
 */
export function applySimAction(
  state: PlayerState,
  action: GameAction,
  mode: ModeDefinition,
  upgradeMap: ReadonlyMap<string, UpgradeDefinition>,
): SimApplyResult {
  switch (action.kind) {
    case 'set_highlight': {
      // Instant and always "applied"; an unknown resource is a no-op (the
      // save/load boundary rejects those, matching the server which ignores
      // highlights naming a non-resource).
      if (mode.resources.includes(action.highlight)) state.meta.highlight = action.highlight
      return { status: 'applied' }
    }
    case 'buy': {
      const reason = purchaseBlockReason(state, action.upgradeId, upgradeMap)
      if (reason === null) {
        applyPurchase(state, action.upgradeId, mode)
        return { status: 'applied' }
      }
      return classify(reason)
    }
    case 'buy_generator': {
      const reason = generatorBlockReason(state, action.generatorId, mode)
      if (reason === null) {
        applyGeneratorPurchase(state, action.generatorId, mode)
        return { status: 'applied' }
      }
      return classify(reason)
    }
  }
}
