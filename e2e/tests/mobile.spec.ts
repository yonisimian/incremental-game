import { test, expect } from './fixtures/test.js'
import { buyUpgrade, openPanel, startBotMatch } from './fixtures/journeys.js'

test('MOB-01 touch controls operate a real bot match', async ({ players }) => {
  const player = await players.create('Mobile')
  await player.open()
  await startBotMatch(player, { type: 'target-score', target: 500 })

  await buyUpgrade(player.page, 'sc-unlock')
  await openPanel(player.page, 0)
  await player.page.locator('#click-btn-r0').tap()
  await expect(player.page.locator('#player-bar-score')).not.toContainText('0 / 500')
})

test('MOB-02 primary controls remain usable in portrait and landscape', async ({ players }) => {
  const player = await players.create('Rotate')
  await player.open()
  await startBotMatch(player, { type: 'timed', durationSec: 35 })

  for (const viewport of [
    { width: 412, height: 915 },
    { width: 915, height: 412 },
  ]) {
    await player.page.setViewportSize(viewport)
    for (const locator of [
      player.page.locator('#quit-btn'),
      player.page.locator('#tab-grid'),
      player.page.locator('#panel-container'),
    ]) {
      const box = await locator.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThan(0)
      expect(box!.height).toBeGreaterThan(0)
    }
  }
})

test('MOB-03 pinch and pan transform the tree without opening a node', async ({ players }) => {
  const player = await players.create('Pinch')
  await player.open()
  await startBotMatch(player, { type: 'timed', durationSec: 35 })
  await openPanel(player.page, 1)
  const canvas = player.page.locator('#tree-canvas')
  const before = await canvas.getAttribute('style')

  await player.page.locator('#tree-viewport').evaluate((viewport) => {
    const pointer = (type: string, pointerId: number, clientX: number, clientY: number): void => {
      viewport.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId,
          pointerType: 'touch',
          clientX,
          clientY,
        }),
      )
    }
    pointer('pointerdown', 1, 100, 150)
    pointer('pointerdown', 2, 200, 150)
    pointer('pointermove', 1, 70, 150)
    pointer('pointermove', 2, 230, 150)
    pointer('pointerup', 1, 70, 150)
    pointer('pointerup', 2, 230, 150)
  })

  expect(await canvas.getAttribute('style')).not.toBe(before)
  await expect(player.page.locator('#upgrade-detail')).toHaveCount(0)
})

test('MOB-04 desktop hotkeys are disabled on coarse pointer', async ({ players }) => {
  const player = await players.create('Coarse')
  await player.open()
  await startBotMatch(player, { type: 'timed', durationSec: 35 })
  await buyUpgrade(player.page, 'sc-unlock')
  await openPanel(player.page, 0)

  // Coarse pointer disables desktop hotkeys. Proving that via the score is
  // unreliable (base production climbs it every tick regardless of input), so
  // assert the panel-switch hotkey was ignored: pressing Control+2 must not move
  // the active tab off Play.
  await player.page.keyboard.press('Space')
  await player.page.keyboard.press('Control+2')
  await expect(player.page.locator('#tab-0')).toHaveAttribute('aria-selected', 'true')
})
