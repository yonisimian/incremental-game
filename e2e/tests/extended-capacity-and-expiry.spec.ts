import { test, expect } from './fixtures/test.js'
import { createRoom } from './fixtures/journeys.js'
import { extendedTimeout, realTimeMs } from './fixtures/time.js'

test('EXT-03 @extended room expires after its ten-game-minute TTL', async ({ players }) => {
  test.setTimeout(extendedTimeout(600_000))
  const player = await players.create('Expiry')
  await player.open()
  await createRoom(player)

  await expect(player.page.locator('.lobby-screen')).toBeVisible({
    timeout: extendedTimeout(600_000, 10_000),
  })
  await expect(player.page.locator('#name-input')).toHaveValue('Expiry')
})

test('EXT-04 @extended room capacity updates diagnostics and rejects room 21', async ({
  players,
}) => {
  test.setTimeout(extendedTimeout(600_000))
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
  const heartbeatWindowMs = realTimeMs(65_000)
  test.setTimeout(extendedTimeout(65_000, 15_000))
  const player = await players.create('Heartbeat')
  await player.open()
  await createRoom(player)
  await expect(player.page.locator('.room-screen')).toBeVisible()

  const started = Date.now()
  await expect
    .poll(() => Date.now() - started, {
      timeout: heartbeatWindowMs + 5_000,
      intervals: [heartbeatWindowMs],
    })
    .toBeGreaterThanOrEqual(heartbeatWindowMs)
  await player.page.locator('#leave-room-btn').click()
  await expect(player.page.locator('.lobby-screen')).toBeVisible()
  await createRoom(player)
  await expect(player.page.locator('.room-screen')).toBeVisible()
})
