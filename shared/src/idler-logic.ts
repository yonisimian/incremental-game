import type { PlayerState, UpgradeId } from './types.js';
import { IDLER_UPGRADES } from './game-config.js';

// ─── Upgrade lookup ──────────────────────────────────────────────────

const idlerUpgradeMap = new Map(IDLER_UPGRADES.map((u) => [u.id, u]));

// ─── Passive income ──────────────────────────────────────────────────

/**
 * Apply one tick of idler passive income to the player state.
 * Mutates `state` in place.
 */
export function applyIdlerPassiveIncome(
  state: PlayerState,
  tickSec: number,
): void {
  const highlight = state.highlight ?? 'wood';
  const highlightMult = state.upgrades['sharpened-axes'] ? 4 : 2;

  // Base wood rate + bonuses
  let baseWood = 1;
  if (state.upgrades['tavern-recruits']) baseWood += 1;
  if (state.upgrades['lumber-mill']) baseWood += 2;

  const woodRate = baseWood * (highlight === 'wood' ? highlightMult : 1);
  const aleRate = 1 * (highlight === 'ale' ? highlightMult : 1);

  const woodGain = woodRate * tickSec;
  const aleGain = aleRate * tickSec;

  state.wood = (state.wood ?? 0) + woodGain;
  state.ale = (state.ale ?? 0) + aleGain;
  state.score += woodGain; // score = total wood ever produced
}

// ─── Purchase ────────────────────────────────────────────────────────

/**
 * Apply an idler upgrade purchase to the player state.
 * Deducts the cost, marks the upgrade as owned, and handles
 * Liquid Courage's ale → wood conversion.
 * Mutates `state` in place.
 *
 * Callers are responsible for validating that the purchase is legal
 * (enough currency, upgrade not already owned, etc.).
 */
export function applyIdlerPurchase(
  state: PlayerState,
  upgradeId: UpgradeId,
): void {
  const def = idlerUpgradeMap.get(upgradeId);
  if (!def) return; // not an idler upgrade

  // Deduct cost from correct currency
  if (def.costCurrency === 'wood') {
    state.wood = (state.wood ?? 0) - def.cost;
  } else if (def.costCurrency === 'ale') {
    state.ale = (state.ale ?? 0) - def.cost;
  }

  state.upgrades[upgradeId] = true;

  // Liquid Courage special: convert remaining ale → wood + score
  if (upgradeId === 'liquid-courage') {
    const remainingAle = state.ale ?? 0;
    state.wood = (state.wood ?? 0) + remainingAle;
    state.score += remainingAle;
    state.ale = 0;
  }
}
