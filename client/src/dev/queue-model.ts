/**
 * Pure helpers for the Queue Simulation tab: building the option lists the
 * editor dropdowns need from a mode, summarizing an action for the table, and
 * creating/mutating session strategies. No DOM here — this is unit-testable.
 */

import { getModeDefinition, getModeFlavor } from '@game/shared'
import type { GameMode, ModeDefinition, QueueStrategy, SimAction } from '@game/shared'

import type { Strategy } from './strategies.js'

export interface Option {
  value: string
  label: string
}

/** Upgrade dropdown options (id → flavored name), in tree order. */
export function upgradeOptions(mode: ModeDefinition): Option[] {
  const names = new Map(getModeFlavor(mode).upgrades.map((u) => [u.id, u.name]))
  return mode.upgrades.map((u) => ({ value: u.id, label: names.get(u.id) ?? u.id }))
}

/** Generator dropdown options. */
export function generatorOptions(mode: ModeDefinition): Option[] {
  const names = new Map(getModeFlavor(mode).generators.map((g) => [g.id, g.name]))
  return mode.generators.map((g) => ({ value: g.id, label: names.get(g.id) ?? g.id }))
}

/** Resource dropdown options. */
export function resourceOptions(mode: ModeDefinition): Option[] {
  const names = new Map(getModeFlavor(mode).resources.map((r) => [r.key, r.displayName]))
  return mode.resources.map((key) => ({ value: key, label: names.get(key) ?? key }))
}

/** Human-readable label for one action, split into columns for the table. */
export function actionSummary(
  action: SimAction,
  mode: ModeDefinition,
): { kind: string; target: string; params: string } {
  const upName = (id: string): string =>
    getModeFlavor(mode).upgrades.find((u) => u.id === id)?.name ?? id
  const genName = (id: string): string =>
    getModeFlavor(mode).generators.find((g) => g.id === id)?.name ?? id
  const resName = (key: string): string =>
    getModeFlavor(mode).resources.find((r) => r.key === key)?.displayName ?? key

  switch (action.kind) {
    case 'buy':
      return { kind: 'buy', target: upName(action.upgradeId), params: `×${action.count ?? 1}` }
    case 'buy_generator':
      return {
        kind: 'generator',
        target: genName(action.generatorId),
        params: `×${action.count ?? 1}`,
      }
    case 'set_highlight':
      return { kind: 'highlight', target: resName(action.highlight), params: '' }
    case 'set_click_rate':
      return {
        kind: 'click rate',
        target: action.resource ? resName(action.resource) : 'score',
        params: `${action.cps} cps`,
      }
    case 'wait':
      return {
        kind: 'wait',
        target: action.until.kind === 'seconds' ? 'time' : resName(action.until.resource),
        params:
          action.until.kind === 'seconds' ? `${action.until.seconds}s` : `≥ ${action.until.amount}`,
      }
  }
}

/** A fresh, empty strategy for the given mode. */
export function makeEmptyStrategy(name: string, mode: GameMode): QueueStrategy {
  return { version: 1, name, mode, actions: [] }
}

/** Deep copy of a strategy (for Duplicate; structuredClone keeps it lossless). */
export function cloneStrategy(strategy: QueueStrategy, name: string): QueueStrategy {
  return { ...structuredClone(strategy), name }
}

/**
 * Convert a legacy enumeration `Strategy` (from `generateStrategies`) into a
 * `QueueStrategy`. The legacy action shape (`buy` / `set_highlight`) is a strict
 * subset of `SimAction`, so this is a 1:1 mapping — nothing is dropped, and any
 * malformed action (missing `upgradeId`/`highlight`) is skipped defensively.
 */
export function enumerationToQueue(strategy: Strategy, mode: GameMode): QueueStrategy {
  const actions: SimAction[] = []
  for (const a of strategy.actions) {
    if (a.type === 'buy' && a.upgradeId !== undefined) {
      actions.push({ kind: 'buy', upgradeId: a.upgradeId })
    } else if (a.type === 'set_highlight' && a.highlight !== undefined) {
      actions.push({ kind: 'set_highlight', highlight: a.highlight })
    }
  }
  return { version: 1, name: strategy.name, mode, actions }
}

/** Swap two actions in place; no-op if either index is out of range. */
export function moveAction(strategy: QueueStrategy, from: number, to: number): void {
  const { actions } = strategy
  if (from < 0 || to < 0 || from >= actions.length || to >= actions.length) return
  ;[actions[from], actions[to]] = [actions[to], actions[from]]
}

/** Resolve a mode's definition (bundled tree already registered by bootstrap). */
export function modeDefOf(mode: GameMode): ModeDefinition {
  return getModeDefinition(mode)
}
