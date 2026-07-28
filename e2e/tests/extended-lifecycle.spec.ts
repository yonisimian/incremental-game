import { test, expect } from './fixtures/test.js'
import {
  finishTargetMatch,
  startBotMatch,
  startRoomMatch,
  waitForEnded,
  waitForPlaying,
} from './fixtures/journeys.js'

test('LIFE-07 @extended real bot completes the buy-upgrade goal with the trophy', async ({
  players,
}) => {
  test.setTimeout(630_000)
  const player = await players.create('TrophyBot')
  await player.open()
  await startBotMatch(player, { type: 'buy-upgrade' })

  await waitForEnded(player, 610_000)
  await expect(player.page.locator('.result')).toContainText('Defeat')
  await expect(player.page.locator('.result')).not.toContainText('Time Limit')
  await expect(player.page.locator('.final-scores')).toHaveCount(0)
})

test('EXT-01 @extended target score reaches its real safety cap', async ({ players }) => {
  test.setTimeout(330_000)
  const first = await players.create('Safety-A')
  const second = await players.create('Safety-B')
  await Promise.all([first.open(), second.open()])
  await startRoomMatch(first, second, { type: 'target-score', target: 100_000 })

  await Promise.all([waitForEnded(first, 310_000), waitForEnded(second, 310_000)])
  await expect(first.page.locator('.result')).toContainText('Time Limit')
  await expect(second.page.locator('.result')).toContainText('Time Limit')
})

test('EXT-02 @extended repeated rematches do not duplicate lifecycle work', async ({ players }) => {
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
    await expect(first.page.locator('#player-bar-score')).toContainText('0 / 10')
  }
})
