import { test, expect } from './fixtures/test.js'
import { createRoom } from './fixtures/journeys.js'

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

test('PREF-01 number settings persist through close and reload', async ({ players }) => {
  const player = await players.create('Settings')
  await player.open()
  await openSettings(player.page)

  await player.page.locator('[data-notation="name"]').click()
  await player.page.locator('[data-decimal="comma"]').click()
  await expect(player.page.locator('#settings-preview')).toContainText(',')
  await player.page.getByRole('button', { name: 'Close' }).click()
  await expect(player.page.locator('#settings-overlay')).toHaveCount(0)

  await player.page.reload()
  await expect(player.page.locator('.lobby-screen')).toBeVisible()
  await openSettings(player.page)
  await expect(player.page.locator('[data-notation="name"]')).toHaveClass(/selected/u)
  await expect(player.page.locator('[data-decimal="comma"]')).toHaveClass(/selected/u)
})

test('PREF-02 copied invite contains the exact room URL @chromium-only', async ({ players }) => {
  const player = await players.create('Clipboard')
  await player.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await player.open()
  const code = await createRoom(player)

  await player.page.locator('#copy-link-btn').click()
  await expect(player.page.locator('#copy-link-btn')).toHaveText('✓')
  const copied = await player.page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe(`http://127.0.0.1:4173/?room=${code}`)
})

test('PREF-03 settings closes by backdrop and Escape without stale overlays', async ({
  players,
}) => {
  const player = await players.create('Modal')
  await player.open()

  await openSettings(player.page)
  await player.page.locator('#settings-overlay').evaluate((overlay) => {
    ;(overlay as HTMLElement).click()
  })
  await expect(player.page.locator('#settings-overlay')).toHaveCount(0)

  await openSettings(player.page)
  await player.page.keyboard.press('Escape')
  await expect(player.page.locator('#settings-overlay')).toHaveCount(0)
  await openSettings(player.page)
  await expect(player.page.locator('#settings-overlay')).toHaveCount(1)
})

test('PREF-04 Web Share receives the exact invite payload', async ({ players }) => {
  const player = await players.create('Share')
  await player.page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: ShareData) => {
        ;(window as Window & { __shared?: ShareData }).__shared = data
        return Promise.resolve()
      },
    })
  })
  await player.open()
  const code = await createRoom(player)

  await player.page.locator('#share-btn').click()
  const shared = await player.page.evaluate(
    () => (window as Window & { __shared?: ShareData }).__shared,
  )
  expect(shared).toEqual({
    title: 'Join my game!',
    url: `http://127.0.0.1:4173/?room=${code}`,
  })
})
