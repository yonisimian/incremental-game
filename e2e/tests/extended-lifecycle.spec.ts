import { test, expect } from './fixtures/test.js'
import {
  finishTargetMatch,
  startBotMatch,
  startRoomMatch,
  waitForEnded,
  waitForPlaying,
} from './fixtures/journeys.js'
import { extendedTimeout } from './fixtures/time.js'

test('LIFE-07 @extended real bot completes the buy-upgrade goal with the trophy', async ({
  players,
}) => {
  test.setTimeout(extendedTimeout(600_000))
  const player = await players.create('TrophyBot')
  await player.open()
  await startBotMatch(player, { type: 'buy-upgrade' })

  await waitForEnded(player, extendedTimeout(600_000, 10_000))
  await expect(player.page.locator('.result')).toContainText('Defeat')
  await expect(player.page.locator('.result')).not.toContainText('Time Limit')
  await expect(player.page.locator('.final-scores')).toHaveCount(0)
})

test('EXT-01 @extended target score reaches its game-time safety cap', async ({ players }) => {
  test.setTimeout(extendedTimeout(300_000))
  const first = await players.create('Safety-A')
  const second = await players.create('Safety-B')
  await Promise.all([first.open(), second.open()])
  await startRoomMatch(first, second, { type: 'target-score', target: 100_000 })

  await Promise.all([
    waitForEnded(first, extendedTimeout(300_000, 10_000)),
    waitForEnded(second, extendedTimeout(300_000, 10_000)),
  ])
  await expect(first.page.locator('.result')).toContainText('Time Limit')
  await expect(second.page.locator('.result')).toContainText('Time Limit')
})

test('EXT-02 repeated rematches do not duplicate lifecycle work', async ({ players }) => {
  test.setTimeout(120_000)
  const first = await players.create('Soak-A')
  const second = await players.create('Soak-B')
  await Promise.all([first.open(), second.open()])
  await startRoomMatch(first, second, { type: 'target-score', target: 10 })

  for (let round = 0; round < 3; round += 1) {
    await finishTargetMatch(first)
    await waitForEnded(second)
    await expect(first.page.locator('.end-screen')).toHaveCount(1)
    if (round === 2) break
    await first.page.locator('#rematch-btn').click()
    await second.page.locator('#rematch-btn').click()
    await Promise.all([waitForPlaying(first), waitForPlaying(second)])
    // Fresh round: the score reset to a single digit against the same `/ 10`
    // goal. Asserting the exact transient `0` would race base production, which
    // starts climbing the score on the first tick.
    await expect(first.page.locator('#player-bar-score')).toHaveText(/^[0-9] \/ 10$/u)
  }
})
