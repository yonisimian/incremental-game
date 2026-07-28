import { test, expect } from './fixtures/test.js'
import { buyUpgrade, openPanel, startRoomMatch, waitForEnded } from './fixtures/journeys.js'
import { WireObserver } from './fixtures/wire-observer.js'

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
  await Promise.all([spy.open(), target.open()])
  await startRoomMatch(spy, target, { type: 'timed', durationSec: 35 })

  await buyUpgrade(spy.page, 'e-se-mr')
  await openPanel(spy.page, 5)
  await expect(spy.page.locator('.espionage-table')).toContainText('Wood')
  await expect(spy.page.locator('.espionage-table')).not.toContainText('Ale')

  await buyUpgrade(spy.page, 'e-se-mr-ps')
  await buyUpgrade(spy.page, 'e-se-cps')
  await buyUpgrade(target.page, 'sc-unlock')
  await openPanel(target.page, 0)
  for (let i = 0; i < 3; i += 1) await target.page.locator('#click-btn-r0').click()
  await openPanel(spy.page, 5)
  await expect(spy.page.getByText('Max CPS')).toBeVisible()
  await expect(spy.page.locator('.espionage-table').first()).toContainText('/s')
})

test('SYS-03 purchase feed is non-retroactive and sends each later purchase once', async ({
  players,
}) => {
  const spy = await players.create('Feed-A')
  const target = await players.create('Feed-B')
  await Promise.all([spy.open(), target.open()])
  await startRoomMatch(spy, target, { type: 'timed', durationSec: 35 })

  await buyUpgrade(target.page, 'a-unlock')
  await buyUpgrade(spy.page, 'e-se-mr')
  await buyUpgrade(spy.page, 'e-se-mr-ps')
  await buyUpgrade(spy.page, 'e-se-p')
  await openPanel(spy.page, 5)
  await expect(spy.page.getByText('No purchases observed yet.')).toBeVisible()

  await buyUpgrade(target.page, 'ir-unlock')
  await openPanel(spy.page, 5)
  await expect(spy.page.locator('.espionage-feed-item')).toHaveCount(1)
  await expect(spy.page.locator('.espionage-feed-item')).toContainText('made a purchase')
  await expect(spy.page.locator('.espionage-feed-item')).toHaveCount(1, { timeout: 1_500 })
})

test('SYS-04 wire redaction progresses from generic to kind and concrete ID', async ({
  players,
}) => {
  const spy = await players.create('WireSpy-A')
  const target = await players.create('WireSpy-B')
  const wire = new WireObserver(spy.page)
  await Promise.all([spy.open(), target.open()])
  await startRoomMatch(spy, target, { type: 'timed', durationSec: 35 })
  await buyUpgrade(spy.page, 'e-se-mr')
  await buyUpgrade(spy.page, 'e-se-mr-ps')
  await buyUpgrade(spy.page, 'e-se-p')
  await buyUpgrade(target.page, 'a-unlock')

  const opponentPayloads = (): string =>
    JSON.stringify(
      wire.received('STATE_UPDATE').map((message) => (message as { opponent: unknown }).opponent),
    )
  await expect.poll(opponentPayloads).not.toContain('a-unlock')
  await buyUpgrade(spy.page, 'e-p-ug')
  await buyUpgrade(target.page, 'ir-unlock')
  await expect.poll(opponentPayloads).toContain('"kind":"upgrade"')
  await expect.poll(opponentPayloads).not.toContain('ir-unlock')

  await buyUpgrade(spy.page, 'e-p-u')
  await buyUpgrade(target.page, 'e-se-mr')
  await expect.poll(opponentPayloads).toContain('e-se-mr')
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
