import { test, expect } from './fixtures/test.js'
import {
  configureGoal,
  createRoom,
  joinRoom,
  startBotMatch,
  startRoomMatch,
  waitForPlaying,
} from './fixtures/journeys.js'
import { WireObserver } from './fixtures/wire-observer.js'

test('ROOM-01 room connection can leave and create again', async ({ players }) => {
  const player = await players.create('RoomReuse')
  await player.open()
  const first = await createRoom(player)

  await player.page.locator('#leave-room-btn').click()
  await expect(player.page.locator('.lobby-screen')).toBeVisible()
  const second = await createRoom(player)
  expect(second).not.toBe(first)
})

test('ROOM-02 room code normalizes input and not-found works by Enter and button', async ({
  players,
}) => {
  const player = await players.create('JoinInput')
  await player.open()
  const input = player.page.locator('#room-code-input')

  await input.fill('abcde2')
  await expect(input).toHaveValue('ABCDE2')
  await input.press('Enter')
  await expect(player.page.locator('#lobby-error')).toHaveText(/not found/u)

  await input.fill('xyzqr9')
  await player.page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(player.page.locator('#lobby-error')).toHaveText(/not found/u)
})

test('ROOM-03 creator configures all goals and exact settings reach both players', async ({
  players,
}) => {
  const creator = await players.create('Settings-A')
  const joiner = await players.create('Settings-B')
  await Promise.all([creator.open(), joiner.open()])
  await createRoom(creator)

  await configureGoal(creator.page, { type: 'timed', durationSec: 999 })
  await expect(creator.page.locator('#goal-duration-input')).toHaveValue('600')
  await configureGoal(creator.page, { type: 'buy-upgrade' })
  await expect(creator.page.locator('[data-goal-type="buy-upgrade"]')).toHaveClass(/selected/u)
  await configureGoal(creator.page, { type: 'target-score', target: 5 })
  await expect(creator.page.locator('#goal-target-input')).toHaveValue('10')

  const code = (await creator.page.locator('#room-code').textContent())!
  await joinRoom(joiner, code)
  await Promise.all([waitForPlaying(creator), waitForPlaying(joiner)])
  await expect(creator.page.locator('#player-bar-score')).toContainText('/ 10')
  await expect(joiner.page.locator('#player-bar-score')).toContainText('/ 10')
  await expect(creator.page.locator('.target-progress')).toContainText('Settings-B')
  await expect(joiner.page.locator('.target-progress')).toContainText('Settings-A')
})

test('ROOM-04 deep-link auto-join clears the consumed room parameter', async ({ players }) => {
  const creator = await players.create('Deep-A')
  const joiner = await players.create('Deep-B')
  await creator.open()
  const code = await createRoom(creator, { type: 'timed', durationSec: 10 })
  await joiner.page.addInitScript(() => {
    localStorage.setItem('player-name', 'Deep-B')
  })

  await joiner.page.goto(`/?room=${code}`)
  await Promise.all([waitForPlaying(creator), waitForPlaying(joiner)])
  await expect(joiner.page).toHaveURL('http://127.0.0.1:4173/')
})

test('ROOM-05 HTML-like names remain text at every public DOM sink', async ({ players }) => {
  const creator = await players.create('<img src=x>')
  const joiner = await players.create('SafePlayer')
  await Promise.all([creator.open(), joiner.open()])
  await startRoomMatch(creator, joiner, { type: 'timed', durationSec: 10 })

  await expect(joiner.page.locator('.scoreboard')).toContainText('<img src=x>')
  await expect(joiner.page.locator('img')).toHaveCount(0)
  await creator.page.locator('#quit-btn').click()
  await expect(joiner.page.locator('.end-screen')).toContainText('<img src=x>')
  await expect(joiner.page.locator('img')).toHaveCount(0)
})

test('QUEUE-01 four queued clients pair FIFO into isolated matches', async ({ players }) => {
  const names = ['FIFO-A', 'FIFO-B', 'FIFO-C', 'FIFO-D']
  const queued = await Promise.all(names.map(async (name) => players.create(name)))
  const wires = queued.map((player) => new WireObserver(player.page))
  await Promise.all(
    queued.map(async (player) => {
      await player.open()
    }),
  )
  for (const player of queued) {
    await player.page.getByRole('button', { name: /Quick Match/u }).click()
  }
  await Promise.all(queued.map(async (player) => waitForPlaying(player)))

  const opponents = wires.map(
    (wire) => (wire.received('ROUND_START').at(-1) as { opponentName?: string }).opponentName,
  )
  expect(opponents).toEqual(['FIFO-B', 'FIFO-A', 'FIFO-D', 'FIFO-C'])
})

test('QUEUE-02 cancelled player is removed before a later pair', async ({ players }) => {
  const cancelled = await players.create('Cancelled')
  const first = await players.create('Later-A')
  const second = await players.create('Later-B')
  const firstWire = new WireObserver(first.page)
  const secondWire = new WireObserver(second.page)
  await Promise.all([cancelled.open(), first.open(), second.open()])

  await cancelled.page.getByRole('button', { name: /Quick Match/u }).click()
  await cancelled.page.keyboard.press('Escape')
  await expect(cancelled.page.locator('.lobby-screen')).toBeVisible()
  await first.page.getByRole('button', { name: /Quick Match/u }).click()
  await second.page.getByRole('button', { name: /Quick Match/u }).click()
  await Promise.all([waitForPlaying(first), waitForPlaying(second)])
  expect((firstWire.received('ROUND_START').at(-1) as { opponentName?: string }).opponentName).toBe(
    'Later-B',
  )
  expect(
    (secondWire.received('ROUND_START').at(-1) as { opponentName?: string }).opponentName,
  ).toBe('Later-A')
})

test('BOT-01 bot request works from quick-match waiting', async ({ players }) => {
  const player = await players.create('QueueBot')
  const wire = new WireObserver(player.page)
  await player.open()
  await player.page.getByRole('button', { name: /Quick Match/u }).click()
  await player.page.locator('#bot-btn').click()

  await waitForPlaying(player)
  expect((wire.received('ROUND_START').at(-1) as { opponentName?: string }).opponentName).toBe(
    'Bot',
  )
  await expect(player.page.locator('#pause-btn')).toBeVisible()
})

test('BOT-02 bot request preserves exact room settings', async ({ players }) => {
  const player = await players.create('RoomBot')
  await player.open()
  await startBotMatch(player, { type: 'target-score', target: 500 })

  await expect(player.page.locator('#player-bar-score')).toContainText('/ 500')
  await expect(player.page.locator('#pause-btn')).toBeVisible()
})
