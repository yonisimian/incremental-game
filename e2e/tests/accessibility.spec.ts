import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/test.js'
import { createRoom, openPanel, waitForEnded } from './fixtures/journeys.js'

async function expectNoSeriousViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  const violations = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )
  expect(violations, `${state}: ${JSON.stringify(violations, null, 2)}`).toEqual([])
}

test('A11Y-01 major player screens have no serious or critical axe violations @chromium-only', async ({
  players,
}) => {
  const first = await players.create('A11y-A')
  const second = await players.create('A11y-B')
  await first.open()
  await expectNoSeriousViolations(first.page, 'lobby')

  await first.page.getByRole('button', { name: 'Settings', exact: true }).click()
  await first.page.locator('#settings-overlay').evaluate(async (overlay) => {
    await Promise.all(
      overlay.getAnimations({ subtree: true }).map((animation) => animation.finished),
    )
  })
  await expectNoSeriousViolations(first.page, 'settings')
  await first.page.getByRole('button', { name: 'Close' }).click()

  await createRoom(first, { type: 'target-score', target: 100 })
  await expectNoSeriousViolations(first.page, 'room')
  await second.open()
  const code = (await first.page.locator('#room-code').textContent())!
  await second.page.locator('#room-code-input').fill(code)
  await second.page.locator('#join-room-btn').click()
  await Promise.all([
    expect(first.page.locator('.playing-screen')).toBeVisible({ timeout: 12_000 }),
    expect(second.page.locator('.playing-screen')).toBeVisible({ timeout: 12_000 }),
  ])
  await expectNoSeriousViolations(first.page, 'playing')

  await openPanel(first.page, 1)
  await first.page.locator('[data-upgrade="be-mf-mr"]').click()
  await expectNoSeriousViolations(first.page, 'upgrade detail')
  await first.page.locator('#upgrade-detail-cancel').click()

  await second.page.locator('#quit-btn').click()
  await waitForEnded(first)
  await first.page.mouse.move(0, 0)
  await first.page.locator('.end-actions').evaluate(async (actions) => {
    await Promise.all(
      actions.getAnimations({ subtree: true }).map((animation) => animation.finished),
    )
  })
  await expectNoSeriousViolations(first.page, 'end')
})

test('A11Y-02 waiting, countdown, and load-error states pass axe @chromium-only', async ({
  players,
  gameServer,
}) => {
  const waiting = await players.create('A11y-Wait')
  await waiting.open()
  await waiting.page.locator('#quick-match-btn').click()
  await expectNoSeriousViolations(waiting.page, 'waiting')
  await waiting.page.locator('#cancel-queue-btn').click()

  const first = await players.create('A11y-Count-A')
  const second = await players.create('A11y-Count-B')
  await Promise.all([first.open(), second.open()])
  const room = await createRoom(first, { type: 'timed', durationSec: 10 })
  await second.page.locator('#room-code-input').fill(room)
  await second.page.locator('#join-room-btn').click()
  await expect(second.page.locator('.countdown-screen')).toBeVisible()
  await expectNoSeriousViolations(second.page, 'countdown')

  const loadError = await players.create('A11y-Error')
  loadError.allowDiagnostics(/Failed to load resource.*500/iu)
  await loadError.page.route(`${gameServer.httpUrl}trees/idler.json`, async (route) => {
    await route.fulfill({ status: 500, body: 'broken' })
  })
  await loadError.page.goto('/')
  await expect(loadError.page.locator('#retry-load-btn')).toBeVisible()
  await expectNoSeriousViolations(loadError.page, 'load-error')
})
