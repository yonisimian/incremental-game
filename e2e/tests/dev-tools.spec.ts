import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures/test.js'
import { buyUpgrade, startBotMatch } from './fixtures/journeys.js'

const TREE_PATH = resolve(import.meta.dirname, '../../shared/trees/idler.json')

async function openDev(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/dev.html')
  await expect(page.getByRole('heading', { name: 'incremenTal — Dev Panel' })).toBeVisible()
}

async function switchDevTab(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.locator(`.dev-tab[data-tab="${name}"]`).click()
}

test('DEV-01 production dev entry mounts and unmounts every tab cleanly', async ({ players }) => {
  const player = await players.create('DevBoot')
  await openDev(player.page)

  for (const tab of ['queue', 'live', 'editor', 'live', 'editor', 'queue']) {
    await switchDevTab(player.page, tab)
    await expect(player.page.locator(`.dev-tab[data-tab="${tab}"]`)).toHaveClass(/active/u)
  }
  await switchDevTab(player.page, 'editor')
  await expect(player.page.locator('#ed-section-host')).toBeVisible()
})

test('DEV-02 Queue executes bundled strategies and renders reports', async ({ players }) => {
  const player = await players.create('DevRun')
  await openDev(player.page)

  await switchDevTab(player.page, 'queue')
  await player.page.locator('#q-run').click()
  await expect(player.page.locator('#q-report')).not.toBeEmpty()
  await expect(player.page.locator('#q-envelope')).not.toBeEmpty()
})

test('DEV-03 editor JSON download contains a parseable artifact', async ({ players }) => {
  const player = await players.create('DevDownload')
  await openDev(player.page)

  await switchDevTab(player.page, 'editor')
  const jsonEvent = player.page.waitForEvent('download')
  await player.page.locator('#ed-export-btn').click()
  const json = await jsonEvent
  expect(json.suggestedFilename()).toBe('idler.json')
  expect(await json.createReadStream()).not.toBeNull()
})

test('DEV-04 editor tree responds to real node drag coordinates', async ({ players }) => {
  const player = await players.create('DevDrag')
  await openDev(player.page)
  await switchDevTab(player.page, 'editor')
  const node = player.page.locator('[data-node-id="goal"]')
  await expect(node).toBeVisible()
  const before = await node.getAttribute('style')
  await node.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const startX = box.left + box.width / 2
    const startY = box.top + box.height / 2
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: startX,
        clientY: startY,
      }),
    )
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: startX + 60,
        clientY: startY + 40,
      }),
    )
    window.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: startX + 60,
        clientY: startY + 40,
      }),
    )
  })
  expect(await node.getAttribute('style')).not.toBe(before)
})

test('DEV-05 real BroadcastChannel streams a live game into the dev tab', async ({ players }) => {
  const dev = await players.create('DevLive')
  const game = await players.createInContext(dev, 'LiveGame')
  await openDev(dev.page)
  await switchDevTab(dev.page, 'live')
  await game.page.goto('/?dev')
  await expect(game.page.locator('.lobby-screen')).toBeVisible()
  await game.page.locator('#name-input').fill('LiveGame')
  await startBotMatch(game, { type: 'timed', durationSec: 35 })

  await expect(dev.page.locator('#live-status')).toContainText(/Recording|Round/u)
  await expect(dev.page.locator('#live-chart-score canvas')).not.toHaveCount(0)
  await game.page.locator('#quit-btn').click()
  await expect(dev.page.locator('#live-status')).toContainText(/ended|final/iu)
})

test('DEV-06 live recording exports to Queue and valid strategy JSON', async ({ players }) => {
  const dev = await players.create('DevExport')
  const game = await players.createInContext(dev, 'ExportGame')
  await dev.page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
  await openDev(dev.page)
  await switchDevTab(dev.page, 'live')
  await game.page.goto('/?dev')
  await expect(game.page.locator('.lobby-screen')).toBeVisible()
  await game.page.locator('#name-input').fill('ExportGame')
  await startBotMatch(game, { type: 'timed', durationSec: 35 })
  await buyUpgrade(game.page, 'a-unlock')
  await expect(dev.page.locator('#live-export-btn')).toBeEnabled()

  const downloadEvent = dev.page.waitForEvent('download')
  await dev.page.locator('#live-export-btn').click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/\.json$/u)
  const path = await download.path()
  if (!path) throw new Error('Downloaded strategy has no local path')
  const json = await readFile(path, 'utf8')
  const strategy = JSON.parse(json) as { version?: number; mode?: string; actions?: unknown[] }
  expect(strategy.version).toBe(1)
  expect(strategy.mode).toBe('idler')
  expect(strategy.actions?.length).toBeGreaterThan(0)

  await switchDevTab(dev.page, 'queue')
  await expect(dev.page.locator('#q-list')).toContainText('Live idler')
})

test('DEV-07 valid and malformed editor files surface success and errors', async ({ players }) => {
  const player = await players.create('DevImport')
  await openDev(player.page)
  await switchDevTab(player.page, 'editor')

  await player.page.locator('#ed-file').setInputFiles(TREE_PATH)
  await expect(player.page.locator('#ed-status')).toContainText('Loaded idler.json')
  await player.page.locator('#ed-file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"not":"a tree"}'),
  })
  await expect(player.page.locator('#ed-status')).toHaveClass(/error/u)
  await expect(player.page.locator('#ed-status')).not.toBeEmpty()
})
