// @game/shared — pure single-step action applier for the strategy simulator.
//
// `applySimAction` applies ONE game action (a single upgrade level, a single
// generator unit, a single generator sale, or a highlight switch) to a player
// state, reusing the same
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

import { applyGeneratorPurchase, applyGeneratorSell } from '../generators.js'
import { applyHighlightSelection, applyPurchase } from '../modes/index.js'
import type { ModeDefinition } from '../modes/types.js'
import {
  generatorBlockReason,
  generatorSellBlockReason,
  purchaseBlockReason,
} from '../purchase-validation.js'
import type { PlayerState, UpgradeDefinition } from '../types.js'
import type {
  BuyAction,
  BuyGeneratorAction,
  SellGeneratorAction,
  SetHighlightAction,
} from './strategy.js'

/** A game action that mutates player state (excludes the engine-only kinds). */
export type GameAction = BuyAction | BuyGeneratorAction | SellGeneratorAction | SetHighlightAction

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
      // Instant and always "applied" — a rejected selection (unknown resource, or
      // highlighting before it's unlocked) is a no-op rather than a block, since
      // more time won't make an unknown resource exist and the save/load boundary
      // already rejects one. `null` releases the highlight. Shares the server's
      // validator, so a strategy can't get a highlight the real game would refuse.
      applyHighlightSelection(state, mode, action.highlight)
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
    case 'sell_generator': {
      const reason = generatorSellBlockReason(state, action.generatorId, mode)
      if (reason === null) {
        applyGeneratorSell(state, action.generatorId, mode)
        return { status: 'applied' }
      }
      return classify(reason) // both sell reasons are permanent — never 'transient'
    }
  }
}
