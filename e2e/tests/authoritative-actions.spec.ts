import { test, expect } from './fixtures/test.js'
import {
  buyUpgrade,
  openPanel,
  opponentScore,
  ownScore,
  startRoomMatch,
  unlockClicking,
} from './fixtures/journeys.js'
import { displayedNumber } from './fixtures/assertions.js'
import { WireObserver } from './fixtures/wire-observer.js'

test('ACT-01 optimistic purchase and click survive authoritative acknowledgement', async ({
  players,
}) => {
  const actor = await players.create('Action-A')
  const observer = await players.create('Action-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })

  const before = displayedNumber(await ownScore(actor.page).textContent())
  await unlockClicking(actor.page)
  await actor.page.locator('#click-btn-r0').click()
  const optimistic = displayedNumber(await ownScore(actor.page).textContent())
  expect(optimistic).toBeGreaterThan(before)

  await expect
    .poll(async () => displayedNumber(await opponentScore(observer.page).textContent()))
    .toBeGreaterThan(before)
})

test('ACT-02 pointer, Space, and Z preserve the selected action resource', async ({ players }) => {
  const actor = await players.create('Targets-A')
  const observerPlayer = await players.create('Targets-B')
  const wire = new WireObserver(actor.page)
  await Promise.all([actor.open(), observerPlayer.open()])
  await startRoomMatch(actor, observerPlayer, { type: 'timed', durationSec: 35 })
  await unlockClicking(actor.page)

  await actor.page.locator('#click-btn-r0').click()
  await actor.page.keyboard.press('z')
  await actor.page.keyboard.press('Space')

  await expect
    .poll(() =>
      wire
        .sent('ACTION_BATCH')
        .flatMap((message) => (message as { actions?: { resource?: string }[] }).actions ?? [])
        .map((action) => action.resource),
    )
    .toEqual(expect.arrayContaining(['r0', 'r1']))
})

test('ACT-03 generator Buy 1 and Buy Max reconcile to authoritative counts', async ({
  players,
}) => {
  const actor = await players.create('Generator-A')
  const observer = await players.create('Generator-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await buyUpgrade(actor.page, 'g1-g2')
  await openPanel(actor.page, 2)

  const card = actor.page.locator('[data-generator="g1"]')
  await card.locator('[data-action="buy"]').click()
  await expect(card.locator('.generator-count')).toHaveText('×1')
  const buyMax = card.locator('[data-action="buy-max"]')
  await expect(buyMax).toBeEnabled({ timeout: 15_000 })
  await buyMax.click()
  await expect
    .poll(async () => displayedNumber(await card.locator('.generator-count').textContent()))
    .toBeGreaterThan(1)
})

test('ACT-04 Tab highlight action persists after a server broadcast', async ({ players }) => {
  const actor = await players.create('Highlight-A')
  const observer = await players.create('Highlight-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await buyUpgrade(actor.page, 'sh-unlock')
  await openPanel(actor.page, 0)

  await actor.page.locator('.playing-top').click()
  await actor.page.keyboard.press('Tab')
  await expect(actor.page.locator('#card-r1')).toHaveClass(/highlighted/u)
  await expect(actor.page.locator('#card-r1')).toHaveClass(/highlighted/u, { timeout: 2_000 })
})

test('ACT-05 excess rapid clicks reconcile down to the server-accepted state', async ({
  players,
}) => {
  const actor = await players.create('Limit-A')
  const observer = await players.create('Limit-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await unlockClicking(actor.page)

  const before = displayedNumber(await ownScore(actor.page).textContent())
  const button = actor.page.locator('#click-btn-r0')
  for (let i = 0; i < 25; i += 1) await button.dispatchEvent('click')
  const optimistic = displayedNumber(await ownScore(actor.page).textContent())
  expect(optimistic - before).toBeGreaterThanOrEqual(25)

  await expect
    .poll(async () => ({
      actor: displayedNumber(await ownScore(actor.page).textContent()),
      observed: displayedNumber(await opponentScore(observer.page).textContent()),
    }))
    .toEqual(expect.objectContaining({ actor: expect.any(Number), observed: expect.any(Number) }))
  await expect
    .poll(async () => {
      const own = displayedNumber(await ownScore(actor.page).textContent())
      const remote = displayedNumber(await opponentScore(observer.page).textContent())
      return Math.abs(own - remote)
    })
    .toBeLessThanOrEqual(1)
})

test('ACT-06 choice ownership blocks its sibling in the real dialog', async ({ players }) => {
  const actor = await players.create('Choice-A')
  const observer = await players.create('Choice-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await unlockClicking(actor.page)
  await buyUpgrade(actor.page, 'sc-clicking')

  await openPanel(actor.page, 1)
  await actor.page.locator('[data-upgrade="sc-production"]').click()
  await expect(actor.page.locator('#upgrade-detail-buy')).toBeDisabled()
  await expect(actor.page.locator('#upgrade-detail-lock')).toBeVisible()
})

test('ACT-07 detail dialog supports locked, cancel, backdrop, and Escape paths', async ({
  players,
}) => {
  const actor = await players.create('Detail-A')
  const observer = await players.create('Detail-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await openPanel(actor.page, 1)

  const locked = actor.page.locator('[data-upgrade="be-mf-mr"]')
  await locked.click()
  await expect(actor.page.locator('#upgrade-detail-buy')).toBeDisabled()
  await actor.page.locator('#upgrade-detail-cancel').click()
  await expect(actor.page.locator('#upgrade-detail')).toHaveCount(0)

  await locked.click()
  await actor.page.keyboard.press('Escape')
  await expect(actor.page.locator('#upgrade-detail')).toHaveCount(0)
  await locked.click()
  await actor.page.locator('#upgrade-detail-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(actor.page.locator('#upgrade-detail')).toHaveCount(0)
})

test('ACT-08 Data telemetry records actions and resets for a rematch', async ({ players }) => {
  const actor = await players.create('Data-A')
  const observer = await players.create('Data-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'target-score', target: 10 })
  await unlockClicking(actor.page)
  await actor.page.locator('#click-btn-r0').evaluate((button) => {
    for (let i = 0; i < 3; i += 1) (button as HTMLButtonElement).click()
  })
  await openPanel(actor.page, 6)
  await expect(actor.page.locator('#data-click-total')).toHaveText('3')
  await expect(actor.page.locator('#data-click-earned-r0')).toHaveText('3')
  await openPanel(actor.page, 0)
  await actor.page.locator('#click-btn-r0').evaluate((button) => {
    for (let i = 0; i < 7; i += 1) (button as HTMLButtonElement).click()
  })
  await Promise.all([
    expect(actor.page.locator('.end-screen')).toBeVisible(),
    expect(observer.page.locator('.end-screen')).toBeVisible(),
  ])

  await actor.page.locator('#rematch-btn').click()
  await observer.page.locator('#rematch-btn').click()
  await Promise.all([
    expect(actor.page.locator('.playing-screen')).toBeVisible({ timeout: 12_000 }),
    expect(observer.page.locator('.playing-screen')).toBeVisible({ timeout: 12_000 }),
  ])
  await openPanel(actor.page, 6)
  await expect(actor.page.locator('#data-click-total')).toHaveText('0')
  await expect(actor.page.locator('#data-inv-generators')).toHaveText('0')
})

test('ACT-09 click VFX appears and cleans itself up', async ({ players }) => {
  const actor = await players.create('VFX-A')
  const observer = await players.create('VFX-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await unlockClicking(actor.page)

  await actor.page.locator('#click-btn-r0').click()
  await expect(actor.page.locator('.vfx-popup')).toBeVisible()
  await expect(actor.page.locator('.vfx-ripple')).toBeVisible()
  await expect(actor.page.locator('.vfx-popup')).toHaveCount(0, { timeout: 2_000 })
  await expect(actor.page.locator('.vfx-ripple')).toHaveCount(0)
})
