import { test, expect } from './fixtures/test.js'
import { buyUpgrade, startRoomMatch } from './fixtures/journeys.js'
import { expectUnchanged } from './fixtures/assertions.js'

test('NOTIF-01 wide-screen toasts sit beside the panels, pause on hover, and close on click', async ({
  players,
}) => {
  const signer = await players.create('Notif-A')
  const viewer = await players.create('Notif-B')
  await Promise.all([signer.open(), viewer.open()])
  await startRoomMatch(signer, viewer, { type: 'timed', durationSec: 35 })

  // A mutual pact the signer unlocks is announced to the viewer as an info toast.
  await buyUpgrade(signer.page, 'ir-unlock')
  await buyUpgrade(signer.page, 'pact-node-2')

  const toast = viewer.page.locator('#toast-layer .toast')
  await expect(toast).toHaveCount(1)
  // Hover first: the toast's 3 s timer is already running.
  await toast.hover()

  const toastBox = await toast.boundingBox()
  const panelBox = await viewer.page.locator('#panel-container').boundingBox()
  expect(toastBox!.x).toBeGreaterThanOrEqual(panelBox!.x + panelBox!.width)

  await expectUnchanged(() => toast.count(), 1, 4_000, 200)

  await toast.click()
  await expect(toast).toHaveCount(0)
})
