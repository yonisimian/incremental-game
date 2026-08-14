import { test, expect } from './fixtures/test.js'
import { startRoomMatch, waitForEnded } from './fixtures/journeys.js'
import { WireObserver } from './fixtures/wire-observer.js'

test('NET-01 failed health probe shows waking then reconnects', async ({ players, gameServer }) => {
  const player = await players.create('HealthFault')
  let failures = 0
  // The aborted probe surfaces differently per engine: Chromium reports
  // ERR_FAILED, Firefox an NS_ERROR_FAILURE plus a cross-origin console error,
  // and WebKit a "Blocked by Web Inspector" request failure.
  player.allowDiagnostics(
    /ERR_FAILED|aborted|NS_ERROR_FAILURE|Cross-Origin Request Blocked|Blocked by Web Inspector/iu,
  )
  await player.page.route(gameServer.httpUrl, async (route) => {
    if (failures++ === 0) await route.abort('failed')
    else await route.continue()
  })

  await player.page.goto('/')
  await expect(player.page.getByText('Waking up server…')).toBeVisible()
  await expect(player.page.getByRole('button', { name: /Quick Match/u })).toBeVisible({
    timeout: 5_000,
  })
})

test('NET-02 invalid tree reaches load-error and Retry recovers', async ({
  players,
  gameServer,
}) => {
  const player = await players.create('TreeFault')
  let invalid = true
  await player.page.route(`${gameServer.httpUrl}trees/idler.json`, async (route) => {
    if (invalid) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"invalid":true}',
      })
    } else {
      await route.continue()
    }
  })

  await player.page.goto('/')
  await expect(player.page.getByText("Couldn't load the game data.")).toBeVisible()
  invalid = false
  await player.page.locator('#retry-load-btn').click()
  await expect(player.page.getByRole('button', { name: /Quick Match/u })).toBeVisible()
})

test('NET-03 failed WebSocket handshake retries against the real server', async ({ players }) => {
  const player = await players.create('SocketRetry')
  let attempts = 0
  await player.page.routeWebSocket(/\/ws$/u, async (socket) => {
    attempts += 1
    if (attempts === 1) await socket.close({ code: 1013, reason: 'temporary failure' })
    else socket.connectToServer()
  })

  await player.page.goto('/')
  await expect(player.page.getByText('Waking up server…')).toBeVisible()
  await expect(player.page.getByRole('button', { name: /Quick Match/u })).toBeVisible({
    timeout: 5_000,
  })
  expect(attempts).toBeGreaterThanOrEqual(2)
})

test('NET-04 routed transport close shows the local disconnect UI', async ({ players }) => {
  const disconnected = await players.create('Drop-A')
  const survivor = await players.create('Drop-B')
  const routed: {
    client?: import('@playwright/test').WebSocketRoute
  } = {}
  await disconnected.page.routeWebSocket(/\/ws$/u, (route) => {
    routed.client = route
    route.connectToServer()
  })
  await Promise.all([disconnected.open(), survivor.open()])
  await startRoomMatch(disconnected, survivor, { type: 'timed', durationSec: 35 })

  if (!routed.client) throw new Error('Expected the game WebSocket to be routed')
  await routed.client.close({
    code: 1001,
    reason: 'network lost',
  })
  await expect(disconnected.page.locator('.disconnected-screen')).toBeVisible()
})

test('NET-04b abrupt page close produces an authoritative remote forfeit', async ({ players }) => {
  const disconnected = await players.create('Forfeit-A')
  const survivor = await players.create('Forfeit-B')
  await Promise.all([disconnected.open(), survivor.open()])
  await startRoomMatch(disconnected, survivor, { type: 'timed', durationSec: 35 })

  await disconnected.page.close()
  await waitForEnded(survivor)
  await expect(survivor.page.locator('.result')).toContainText('Disconnected')
})

test('NET-05 disconnected queue entry cannot ghost-pair later players', async ({ players }) => {
  const ghost = await players.create('Ghost')
  const first = await players.create('Live-A')
  const second = await players.create('Live-B')
  const firstWire = new WireObserver(first.page)
  const secondWire = new WireObserver(second.page)
  await Promise.all([ghost.open(), first.open(), second.open()])
  await ghost.page.getByRole('button', { name: /Quick Match/u }).click()
  await ghost.page.close()

  await first.page.getByRole('button', { name: /Quick Match/u }).click()
  await expect(first.page.locator('.waiting-screen')).toBeVisible()
  await second.page.getByRole('button', { name: /Quick Match/u }).click()
  await expect(first.page.locator('.playing-screen')).toBeVisible({ timeout: 12_000 })
  await expect(second.page.locator('.playing-screen')).toBeVisible({ timeout: 12_000 })
  expect((firstWire.received('ROUND_START').at(-1) as { opponentName?: string }).opponentName).toBe(
    'Live-B',
  )
  expect(
    (secondWire.received('ROUND_START').at(-1) as { opponentName?: string }).opponentName,
  ).toBe('Live-A')
})
