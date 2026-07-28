import { test, expect } from './fixtures/test.js'
import {
  finishTargetMatch,
  startBotMatch,
  startRoomMatch,
  waitForEnded,
  waitForPlaying,
} from './fixtures/journeys.js'
import { expectStable } from './fixtures/assertions.js'

test('LIFE-01 bot pause freezes and resume re-anchors timer and resources', async ({ players }) => {
  const player = await players.create('Pause')
  await player.open()
  await startBotMatch(player, { type: 'timed', durationSec: 35 })

  await player.page.getByRole('button', { name: 'Pause match' }).click()
  await expect(player.page.locator('#pause-banner')).toBeVisible()
  await Promise.all([
    expectStable(player.page.locator('#timer')),
    expectStable(player.page.locator('#header-r0')),
  ])
  const frozen = await player.page.locator('#timer').textContent()
  await player.page.getByRole('button', { name: 'Resume match' }).click()
  await expect(player.page.locator('#pause-banner')).toBeHidden()
  await expect(player.page.locator('#timer')).not.toHaveText(frozen!, { timeout: 2_000 })
})

test('LIFE-02 target completion maps complementary results and resets to lobby', async ({
  players,
}) => {
  const winner = await players.create('Winner')
  const loser = await players.create('Loser')
  await Promise.all([winner.open(), loser.open()])
  await startRoomMatch(winner, loser, { type: 'target-score', target: 10 })

  await finishTargetMatch(winner)
  await waitForEnded(loser)
  await expect(winner.page.locator('.result')).toContainText('Victory')
  await expect(loser.page.locator('.result')).toContainText('Defeat')
  await expect(winner.page.locator('.stats')).toContainText('Upgrades:')
  await winner.page.locator('#lobby-btn').click()
  await expect(winner.page.locator('.lobby-screen')).toBeVisible()
})

test('LIFE-03 two-player rematch preserves settings with fresh state', async ({ players }) => {
  const first = await players.create('Rematch-A')
  const second = await players.create('Rematch-B')
  await Promise.all([first.open(), second.open()])
  await startRoomMatch(first, second, { type: 'target-score', target: 10 })
  await finishTargetMatch(first)
  await waitForEnded(second)

  await first.page.locator('#rematch-btn').click()
  await expect(first.page.locator('.waiting-screen')).toBeVisible()
  await second.page.locator('#rematch-btn').click()
  await Promise.all([waitForPlaying(first), waitForPlaying(second)])
  await expect(first.page.locator('#player-bar-score')).toContainText('0 / 10')
  await expect(second.page.locator('#player-bar-score')).toContainText('0 / 10')
})

test('LIFE-04 bot request works from rematch waiting', async ({ players }) => {
  const first = await players.create('RematchBot-A')
  const second = await players.create('RematchBot-B')
  await Promise.all([first.open(), second.open()])
  await startRoomMatch(first, second, { type: 'target-score', target: 10 })
  await finishTargetMatch(first)
  await waitForEnded(second)

  await first.page.locator('#rematch-btn').click()
  await first.page.locator('#bot-btn').click()
  await waitForPlaying(first)
  await expect(first.page.locator('.playing-screen')).toContainText('Bot')
  await expect(first.page.locator('#player-bar-score')).toContainText('/ 10')
})

test('LIFE-05 quit during countdown and play yields correct terminal states', async ({
  players,
}) => {
  const first = await players.create('Quit-A')
  const second = await players.create('Quit-B')
  await Promise.all([first.open(), second.open()])
  await startRoomMatch(first, second, { type: 'timed', durationSec: 35 })

  await first.page.locator('#quit-btn').click()
  await expect(first.page.locator('.lobby-screen')).toBeVisible()
  await waitForEnded(second)
  await expect(second.page.locator('.result')).toContainText('Opponent Quit')
})

test('LIFE-06 a real ten-second timed match leaves zero without dwelling', async ({ players }) => {
  test.setTimeout(30_000)
  const first = await players.create('Timed-A')
  const second = await players.create('Timed-B')
  await Promise.all([first.open(), second.open()])
  await startRoomMatch(first, second, { type: 'timed', durationSec: 10 })

  await expect(first.page.locator('#timer')).toContainText(':', { timeout: 2_000 })
  await Promise.all([waitForEnded(first, 15_000), waitForEnded(second, 15_000)])
  await expect(first.page.locator('.result')).toContainText(/Victory|Defeat|Draw/u)
})

test('LIFE-08 concurrent matches never cross names, scores, or quits', async ({ players }) => {
  const a1 = await players.create('Iso-A1')
  const a2 = await players.create('Iso-A2')
  const b1 = await players.create('Iso-B1')
  const b2 = await players.create('Iso-B2')
  await Promise.all([a1.open(), a2.open(), b1.open(), b2.open()])
  await startRoomMatch(a1, a2, { type: 'timed', durationSec: 35 })
  await startRoomMatch(b1, b2, { type: 'timed', durationSec: 35 })

  await expect(a1.page.locator('.playing-screen')).toContainText('Iso-A2')
  await expect(a1.page.locator('.playing-screen')).not.toContainText('Iso-B2')
  await b1.page.locator('#quit-btn').click()
  await waitForEnded(b2)
  await expect(a1.page.locator('.playing-screen')).toBeVisible()
  await expect(a2.page.locator('.playing-screen')).toBeVisible()
})
