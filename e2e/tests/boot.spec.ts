import { test, expect } from './fixtures/test.js'
import { createRoom, joinRoom, waitForPlaying } from './fixtures/journeys.js'

test('BOOT-01 built client boots through health, tree, and WebSocket', async ({ players }) => {
  const player = await players.create('Boot')
  await player.open()

  await expect(player.page.locator('.lobby-screen')).toBeVisible()
  await expect(player.page).toHaveTitle('incremenTal')
})

test('BOOT-02 player name survives a real reload', async ({ players }) => {
  const player = await players.create('Persistent')
  await player.open()
  await player.page.reload()

  await expect(player.page.getByRole('button', { name: /Quick Match/u })).toBeVisible()
  await expect(player.page.locator('#name-input')).toHaveValue('Persistent')
})

test('BOOT-03 configured countdown transitions both players into play', async ({ players }) => {
  const creator = await players.create('Countdown-A')
  const joiner = await players.create('Countdown-B')
  await Promise.all([creator.open(), joiner.open()])
  const code = await createRoom(creator, { type: 'timed', durationSec: 10 })
  await joinRoom(joiner, code)

  await expect(creator.page.locator('.countdown-screen')).toBeVisible()
  await expect(joiner.page.locator('.countdown-screen')).toBeVisible()
  await Promise.all([waitForPlaying(creator), waitForPlaying(joiner)])
})

test('BOOT-04 server serves canonical tree bytes and headers', async ({ players, gameServer }) => {
  const player = await players.create('Tree')
  await player.open()
  const response = await player.page.request.get(`${gameServer.httpUrl}trees/idler.json`)

  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/json')
  expect(response.headers()['access-control-allow-origin']).toBe('*')
  expect(response.headers()['cache-control']).toBe('no-cache')
  const tree = (await response.json()) as { id: string; upgrades: unknown[] }
  expect(tree.id).toBe('idler')
  const serialized = JSON.stringify(tree.upgrades)
  for (const id of ['sc-unlock', 'g1-g2', 'sh-unlock']) expect(serialized).toContain(`"${id}"`)
})
