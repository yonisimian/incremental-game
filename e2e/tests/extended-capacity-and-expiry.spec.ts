import { test, expect } from './fixtures/test.js'
import { createRoom } from './fixtures/journeys.js'

test('EXT-03 @extended room expires after its real ten-minute TTL', async ({ players }) => {
  test.setTimeout(630_000)
  const player = await players.create('Expiry')
  await player.open()
  await createRoom(player)

  await expect(player.page.locator('.lobby-screen')).toBeVisible({ timeout: 610_000 })
  await expect(player.page.locator('#name-input')).toHaveValue('Expiry')
})

test('EXT-04 @extended room capacity updates diagnostics and rejects room 21', async ({
  players,
}) => {
  test.setTimeout(90_000)
  const owners = []
  for (let i = 0; i < 20; i += 1) {
    const player = await players.create(`Capacity-${i}`)
    await player.open()
    await createRoom(player)
    owners.push(player)
  }

  await owners[0].page.keyboard.press('F6')
  await expect(owners[0].page.locator('#perf-overlay')).toContainText('Active rooms: 20 / 20', {
    timeout: 8_000,
  })
  const overflow = await players.create('Capacity-Overflow')
  await overflow.open()
  await overflow.page.locator('#create-room-btn').click()
  await expect(overflow.page.locator('#lobby-error')).toContainText('Server is busy')
})

test('EXT-05 @extended connection remains usable across multiple heartbeat cycles', async ({
  players,
}) => {
  test.setTimeout(90_000)
  const player = await players.create('Heartbeat')
  await player.open()
  await createRoom(player)
  await expect(player.page.locator('.room-screen')).toBeVisible()

  const started = Date.now()
  await expect
    .poll(() => Date.now() - started, { timeout: 70_000, intervals: [65_000] })
    .toBeGreaterThanOrEqual(65_000)
  await player.page.locator('#leave-room-btn').click()
  await expect(player.page.locator('.lobby-screen')).toBeVisible()
  await createRoom(player)
  await expect(player.page.locator('.room-screen')).toBeVisible()
})
