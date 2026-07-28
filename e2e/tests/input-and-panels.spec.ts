import { test, expect } from './fixtures/test.js'
import {
  buyUpgrade,
  createRoom,
  openPanel,
  startBotMatch,
  startRoomMatch,
  unlockClicking,
} from './fixtures/journeys.js'
import { WireObserver } from './fixtures/wire-observer.js'

test('INPUT-01 Ctrl panel navigation skips locks and maintains ARIA', async ({ players }) => {
  const actor = await players.create('Panel-A')
  const observer = await players.create('Panel-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await buyUpgrade(actor.page, 'a-unlock')
  await buyUpgrade(actor.page, 'ir-unlock')
  await buyUpgrade(actor.page, 'e-se-mr')

  await actor.page.keyboard.press('Control+4')
  await expect(actor.page.locator('#tab-3')).toHaveAttribute('aria-selected', 'true')
  await expect(actor.page.locator('#panel-container')).toHaveAttribute('aria-labelledby', 'tab-3')
  await actor.page.keyboard.press('Control+ArrowRight')
  await expect(actor.page.locator('#tab-4')).toHaveAttribute('aria-selected', 'true')
})

test('INPUT-02 repeat and modifier guards do not emit extra click actions', async ({ players }) => {
  const actor = await players.create('Key-A')
  const observerPlayer = await players.create('Key-B')
  const wire = new WireObserver(actor.page)
  await Promise.all([actor.open(), observerPlayer.open()])
  await startRoomMatch(actor, observerPlayer, { type: 'timed', durationSec: 35 })
  await unlockClicking(actor.page)

  await actor.page.keyboard.press('Space')
  await expect.poll(() => wire.sent('ACTION_BATCH').length).toBeGreaterThan(0)
  const actionCount = (): number =>
    wire
      .sent('ACTION_BATCH')
      .flatMap((message) => (message as { actions?: unknown[] }).actions ?? []).length
  const baseline = actionCount()

  await actor.page.evaluate(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, code: 'Space', key: ' ', repeat: true }),
    )
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'x', altKey: true }),
    )
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'x', metaKey: true }),
    )
  })
  await expect.poll(actionCount).toBe(baseline)
})

test('INPUT-03 C, P, F6, and Escape execute their context-specific behavior', async ({
  players,
}) => {
  const player = await players.create('Hotkeys')
  await player.open()
  await startBotMatch(player, { type: 'timed', durationSec: 35 })

  await player.page.keyboard.press('c')
  await openPanel(player.page, 1)
  await expect(player.page.locator('[data-upgrade="a-unlock"]')).toHaveClass(/owned/u)

  await player.page.keyboard.press('F6')
  await expect(player.page.locator('#perf-overlay')).toBeVisible()
  await player.page.keyboard.press('p')
  await expect(player.page.locator('#pause-banner')).toBeVisible()
  await player.page.keyboard.press('p')
  await expect(player.page.locator('#pause-banner')).toBeHidden()

  await player.page.locator('[data-upgrade="be-mf-mr"]').click()
  await player.page.keyboard.press('Escape')
  await expect(player.page.locator('#upgrade-detail')).toHaveCount(0)
  await player.page.keyboard.press('Escape')
  await expect(player.page.locator('.lobby-screen')).toBeVisible()
})

test('INPUT-04 tablist arrows, Home, and End move focus and selection', async ({ players }) => {
  const actor = await players.create('Tabs-A')
  const observer = await players.create('Tabs-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })

  const first = actor.page.locator('#tab-0')
  await first.focus()
  await first.press('ArrowRight')
  await expect(actor.page.locator('#tab-1')).toBeFocused()
  await expect(actor.page.locator('#tab-1')).toHaveAttribute('aria-selected', 'true')
  await actor.page.locator('#tab-1').press('End')
  await expect(actor.page.locator('#tab-6')).toBeFocused()
  await actor.page.locator('#tab-6').press('Home')
  await expect(first).toBeFocused()
})

test('INPUT-05 focused room input keeps game hotkeys out', async ({ players }) => {
  const player = await players.create('InputGuard')
  await player.open()
  await createRoom(player, { type: 'timed', durationSec: 35 })
  const input = player.page.locator('#goal-duration-input')
  await input.focus()
  await input.fill('42')
  await input.press('ArrowUp')
  await input.press('p')

  await expect(player.page.locator('.room-screen')).toBeVisible()
  await expect(input).toHaveValue('43')
})

test('INPUT-06 Tab prevents focus wandering while cycling highlight', async ({ players }) => {
  const actor = await players.create('Tab-A')
  const observer = await players.create('Tab-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await buyUpgrade(actor.page, 'sh-unlock')
  await openPanel(actor.page, 0)
  await actor.page.locator('.playing-top').click()

  const focusedBefore = await actor.page.evaluate(() => document.activeElement?.tagName)
  await actor.page.keyboard.press('Tab')
  await expect(actor.page.locator('#card-r1')).toHaveClass(/highlighted/u)
  expect(await actor.page.evaluate(() => document.activeElement?.tagName)).toBe(focusedBefore)
})

test('INPUT-07 tree wheel/pan transform survives tab switches', async ({ players }) => {
  const actor = await players.create('Pan-A')
  const observer = await players.create('Pan-B')
  await Promise.all([actor.open(), observer.open()])
  await startRoomMatch(actor, observer, { type: 'timed', durationSec: 35 })
  await openPanel(actor.page, 1)
  const viewport = actor.page.locator('#tree-viewport')
  const canvas = actor.page.locator('#tree-canvas')
  const initial = await canvas.getAttribute('style')

  await viewport.hover()
  await actor.page.mouse.wheel(0, -100)
  const zoomed = await canvas.getAttribute('style')
  expect(zoomed).not.toBe(initial)
  const box = await viewport.boundingBox()
  expect(box).not.toBeNull()
  await actor.page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await actor.page.mouse.down()
  await actor.page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 + 20)
  await actor.page.mouse.up()
  const panned = await canvas.getAttribute('style')
  expect(panned).not.toBe(zoomed)

  await openPanel(actor.page, 6)
  await openPanel(actor.page, 1)
  await expect(actor.page.locator('#tree-canvas')).toHaveAttribute('style', panned!)
})
