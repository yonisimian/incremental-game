import { test, expect } from './fixtures/test.js'
import { buyUpgrade, openPanel, startRoomMatch, waitForEnded } from './fixtures/journeys.js'
import { expectUnchanged } from './fixtures/assertions.js'
import { WireObserver } from './fixtures/wire-observer.js'

interface ObservedStateUpdate {
  readonly tick: number
  readonly player: { readonly upgrades: Record<string, number> }
  readonly opponent: {
    readonly resources: Record<string, number>
    readonly rates: Record<string, number>
    readonly peakCps?: number
    readonly purchases?: { readonly t: number; readonly kind?: string; readonly id?: string }[]
  }
}

function stateUpdates(wire: WireObserver): ObservedStateUpdate[] {
  return wire.received('STATE_UPDATE') as ObservedStateUpdate[]
}

function latestState(wire: WireObserver): ObservedStateUpdate | undefined {
  return stateUpdates(wire).at(-1)
}

async function waitForOwnedUpgrade(
  wire: WireObserver,
  upgradeId: string,
): Promise<ObservedStateUpdate> {
  await expect.poll(() => latestState(wire)?.player.upgrades[upgradeId] ?? 0).toBeGreaterThan(0)
  return latestState(wire)!
}

async function waitForTickAfter(wire: WireObserver, tick: number): Promise<void> {
  await expect.poll(() => latestState(wire)?.tick ?? -1).toBeGreaterThan(tick)
}

test('SYS-01 free Attack and Relations branches unlock their rendered cards', async ({
  players,
}) => {
  const actor = await players.create('Systems-A')
  const observer = await players.create('Systems-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })

  await buyUpgrade(actor.page, 'a-unlock')
  await buyUpgrade(actor.page, 'node')
  await openPanel(actor.page, 3)
  await expect(actor.page.locator('.attack-item')).toHaveCount(1)
  await expect(actor.page.locator('.attack-btn')).toBeDisabled()

  await buyUpgrade(actor.page, 'ir-unlock')
  await buyUpgrade(actor.page, 'pact-node')
  await openPanel(actor.page, 4)
  await expect(actor.page.locator('.pact-item')).toHaveCount(1)
  await expect(actor.page.locator('.pact-btn')).toBeDisabled()
})

test('SYS-02 espionage reveals only purchased resource, rate, and CPS tiers', async ({
  players,
}) => {
  const spy = await players.create('Spy-A')
  const target = await players.create('Spy-B')
  const spyWire = new WireObserver(spy.page)
  const targetWire = new WireObserver(target.page)
  await Promise.all([spy.open(), target.open()])
  await startRoomMatch(spy, target, { type: 'timed', durationSec: 35 })

  await buyUpgrade(spy.page, 'e-se-mr')
  await waitForOwnedUpgrade(spyWire, 'e-se-mr')
  await expect.poll(() => latestState(spyWire)?.opponent.resources.r0).toEqual(expect.any(Number))
  expect(latestState(spyWire)?.opponent.resources).not.toHaveProperty('r1')
  await openPanel(spy.page, 5)
  await expect(spy.page.locator('.espionage-table')).toContainText('Wood')
  await expect(spy.page.locator('.espionage-table')).not.toContainText('Ale')

  await buyUpgrade(spy.page, 'e-se-mr-ps')
  await buyUpgrade(spy.page, 'e-se-cps')
  await waitForOwnedUpgrade(spyWire, 'e-se-cps')
  await buyUpgrade(target.page, 'sc-unlock')
  await waitForOwnedUpgrade(targetWire, 'sc-unlock')
  await openPanel(target.page, 0)
  for (let i = 0; i < 3; i += 1) await target.page.locator('#click-btn-r0').click()
  await expect.poll(() => latestState(targetWire)?.player.upgrades['sc-unlock'] ?? 0).toBe(1)
  await expect.poll(() => latestState(spyWire)?.opponent.rates.r0).toEqual(expect.any(Number))
  await expect.poll(() => latestState(spyWire)?.opponent.peakCps ?? 0).toBeGreaterThan(0)
  await openPanel(spy.page, 5)
  await expect(spy.page.getByText('Max CPS')).toBeVisible()
  await expect(spy.page.locator('.espionage-table').first()).toContainText('/s')
})

test('SYS-03 purchase feed is non-retroactive and sends each later purchase once', async ({
  players,
}) => {
  const spy = await players.create('Feed-A')
  const target = await players.create('Feed-B')
  const spyWire = new WireObserver(spy.page)
  await Promise.all([spy.open(), target.open()])
  await startRoomMatch(spy, target, { type: 'timed', durationSec: 35 })

  await buyUpgrade(target.page, 'a-unlock')
  await buyUpgrade(spy.page, 'e-se-mr')
  await buyUpgrade(spy.page, 'e-se-mr-ps')
  await buyUpgrade(spy.page, 'e-se-p')
  const feedEnabled = await waitForOwnedUpgrade(spyWire, 'e-se-p')
  await waitForTickAfter(spyWire, feedEnabled.tick)
  await openPanel(spy.page, 5)
  await expect(spy.page.getByText('No purchases observed yet.')).toBeVisible()

  await buyUpgrade(target.page, 'ir-unlock')
  await openPanel(spy.page, 5)
  await expect(spy.page.locator('.espionage-feed-item')).toHaveCount(1)
  await expect(spy.page.locator('.espionage-feed-item')).toContainText('made a purchase')
  await expectUnchanged(() => spy.page.locator('.espionage-feed-item').count(), 1, 1_500, 100)
})

test('SYS-04 wire redaction progresses from generic to kind and concrete ID', async ({
  players,
}) => {
  const spy = await players.create('WireSpy-A')
  const target = await players.create('WireSpy-B')
  const spyWire = new WireObserver(spy.page)
  const targetWire = new WireObserver(target.page)
  await Promise.all([spy.open(), target.open()])
  await startRoomMatch(spy, target, { type: 'timed', durationSec: 35 })
  await buyUpgrade(spy.page, 'e-se-mr')
  await buyUpgrade(spy.page, 'e-se-mr-ps')
  await buyUpgrade(target.page, 'a-unlock')
  await waitForOwnedUpgrade(targetWire, 'a-unlock')

  const feedStart = stateUpdates(spyWire).length
  await buyUpgrade(spy.page, 'e-se-p')
  const feedEnabled = await waitForOwnedUpgrade(spyWire, 'e-se-p')
  await waitForTickAfter(spyWire, feedEnabled.tick)

  const purchasesSince = (index: number) =>
    stateUpdates(spyWire)
      .slice(index)
      .flatMap((message) => message.opponent.purchases ?? [])
  expect(JSON.stringify(purchasesSince(feedStart))).not.toContain('a-unlock')

  const genericStart = stateUpdates(spyWire).length
  await buyUpgrade(target.page, 'node')
  const genericPurchase = await waitForOwnedUpgrade(targetWire, 'node')
  await waitForTickAfter(spyWire, genericPurchase.tick)
  const genericEvents = purchasesSince(genericStart)
  expect(genericEvents).toHaveLength(1)
  expect(genericEvents[0]).toEqual({ t: expect.any(Number) })

  await buyUpgrade(spy.page, 'e-p-ug')
  await waitForOwnedUpgrade(spyWire, 'e-p-ug')
  const kindStart = stateUpdates(spyWire).length
  await buyUpgrade(target.page, 'ir-unlock')
  const kindPurchase = await waitForOwnedUpgrade(targetWire, 'ir-unlock')
  await waitForTickAfter(spyWire, kindPurchase.tick)
  const kindEvents = purchasesSince(kindStart)
  expect(kindEvents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'upgrade' })]))
  expect(kindEvents.every((event) => event.id === undefined)).toBe(true)

  await buyUpgrade(spy.page, 'e-p-u')
  await waitForOwnedUpgrade(spyWire, 'e-p-u')
  const idStart = stateUpdates(spyWire).length
  await buyUpgrade(target.page, 'e-se-mr')
  const idPurchase = await waitForOwnedUpgrade(targetWire, 'e-se-mr')
  await waitForTickAfter(spyWire, idPurchase.tick)
  expect(purchasesSince(idStart)).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'upgrade', id: 'e-se-mr' })]),
  )
})

test('SYS-05 passive attack debuff reaches victim header and Data panel', async ({ players }) => {
  const attacker = await players.create('Debuff-A')
  const victim = await players.create('Debuff-B')
  await Promise.all([attacker.open(), victim.open()])
  await startRoomMatch(attacker, victim, { type: 'timed', durationSec: 35 })

  await buyUpgrade(attacker.page, 'a-unlock')
  await buyUpgrade(attacker.page, 'node-3')
  await expect(victim.page.locator('#rate-r0')).toHaveText('+0.9/s')
  await openPanel(victim.page, 6)
  await expect(victim.page.locator('#data-total-rate-r0')).toHaveText('+0.9/s')
})

test('SYS-06 buy-upgrade mode never exposes opponent score on wire or UI', async ({ players }) => {
  const first = await players.create('Private-A')
  const second = await players.create('Private-B')
  const wire = new WireObserver(first.page)
  await Promise.all([first.open(), second.open()])
  await startRoomMatch(first, second, { type: 'buy-upgrade' })

  await expect(first.page.locator('.scoreboard')).toHaveCount(0)
  await expect(first.page.locator('.target-progress')).toHaveCount(0)
  await expect.poll(() => wire.received('STATE_UPDATE').length).toBeGreaterThan(0)
  for (const message of wire.received('STATE_UPDATE')) {
    expect((message as { opponent: Record<string, unknown> }).opponent).not.toHaveProperty('score')
  }

  await second.page.locator('#quit-btn').click()
  await waitForEnded(first)
  await expect(first.page.locator('.final-scores')).toHaveCount(0)
  const ends = wire.received('ROUND_END') as { finalScores: Record<string, unknown> }[]
  expect(ends.at(-1)?.finalScores).not.toHaveProperty('opponent')
})
