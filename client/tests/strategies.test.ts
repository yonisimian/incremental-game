import { describe, expect, it } from 'vitest'
import { getModeDefinition, isPrerequisiteSatisfied } from '@game/shared'
import type { PlayerState } from '@game/shared'
import { IDLER_STRATEGIES, generateStrategies } from '../src/dev/strategies.js'
import { stubMode } from './_stub-mode.js'

const modeDef = getModeDefinition('idler')
const timedUpgrades = modeDef.upgrades.filter((u) => !u.goalType)

describe('IDLER_STRATEGIES — auto-generated', () => {
  it('includes baseline strategies (no upgrades)', () => {
    const baselines = IDLER_STRATEGIES.filter((s) => s.name.startsWith('No upgrades'))
    expect(baselines.length).toBeGreaterThanOrEqual(1)
  })

  it('generates a non-trivial number of strategies', () => {
    // Enumeration only stays tractable for small trees; the large real tree is
    // skipped (baseline only). Validate the generator against the synthetic stub
    // (3 non-trophy upgrades: uh, uh2, u1) where several permutations are produced.
    const strategies = generateStrategies(stubMode)
    expect(strategies.length).toBeGreaterThanOrEqual(4)
  })

  it('every strategy starts with a set_highlight action', () => {
    for (const s of IDLER_STRATEGIES) {
      expect(s.actions[0].type).toBe('set_highlight')
      expect(s.actions[0].highlight).toBeDefined()
    }
  })

  it('every buy action references a valid upgrade ID', () => {
    const validIds = new Set(modeDef.upgrades.map((u) => u.id))
    for (const s of IDLER_STRATEGIES) {
      for (const a of s.actions) {
        if (a.type === 'buy') {
          expect(validIds.has(a.upgradeId!), `${s.name}: unknown upgrade ${a.upgradeId}`).toBe(true)
        }
      }
    }
  })

  it('no strategy buys the same upgrade twice', () => {
    for (const s of IDLER_STRATEGIES) {
      const buyIds = s.actions.filter((a) => a.type === 'buy').map((a) => a.upgradeId)
      expect(new Set(buyIds).size, `${s.name}: duplicate buys`).toBe(buyIds.length)
    }
  })

  it('prerequisites are purchased before dependents', () => {
    for (const s of IDLER_STRATEGIES) {
      const purchased = new Set<string>()
      for (const a of s.actions) {
        if (a.type !== 'buy') continue
        const upgrade = modeDef.upgrades.find((u) => u.id === a.upgradeId)
        if (!upgrade?.prerequisites) {
          purchased.add(a.upgradeId!)
          continue
        }
        // Verify prereqs are satisfied using the same function the generator uses
        const state: PlayerState = {
          score: 0,
          resources: {},
          upgrades: Object.fromEntries([...purchased].map((id) => [id, 1])),
          generators: {},
          meta: {},
        }
        expect(
          isPrerequisiteSatisfied(upgrade.prerequisites, state),
          `${s.name}: ${a.upgradeId} bought before its prereqs`,
        ).toBe(true)
        purchased.add(a.upgradeId!)
      }
    }
  })

  it('no strategy includes both members of a choice group', () => {
    const choiceGroups = new Map<string, string[]>()
    for (const u of timedUpgrades) {
      if (u.choiceGroup) {
        const list = choiceGroups.get(u.choiceGroup) ?? []
        list.push(u.id)
        choiceGroups.set(u.choiceGroup, list)
      }
    }

    for (const s of IDLER_STRATEGIES) {
      const buyIds = new Set(s.actions.filter((a) => a.type === 'buy').map((a) => a.upgradeId))
      for (const [group, members] of choiceGroups) {
        const count = members.filter((id) => buyIds.has(id)).length
        expect(count, `${s.name}: multiple picks from choice group "${group}"`).toBeLessThanOrEqual(
          1,
        )
      }
    }
  })

  it('no trophy upgrades are included (filtered to timed-goal only)', () => {
    const trophyIds = new Set(modeDef.upgrades.filter((u) => u.goalType).map((u) => u.id))
    for (const s of IDLER_STRATEGIES) {
      for (const a of s.actions) {
        if (a.type === 'buy') {
          expect(trophyIds.has(a.upgradeId!), `${s.name}: includes trophy ${a.upgradeId}`).toBe(
            false,
          )
        }
      }
    }
  })

  it('strategy names are unique', () => {
    const names = IDLER_STRATEGIES.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
