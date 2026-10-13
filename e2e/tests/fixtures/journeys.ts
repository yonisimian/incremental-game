import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { GamePlayer } from './player.js'

export type GoalSetup =
  | { readonly type: 'target-score'; readonly target?: number }
  | { readonly type: 'timed'; readonly durationSec?: number }
  | { readonly type: 'buy-upgrade' }
  | { readonly type: 'random' }

export async function createRoom(player: GamePlayer, goal?: GoalSetup): Promise<string> {
  await player.page.getByRole('button', { name: /Create Room/u }).click()
  const code = player.page.locator('#room-code')
  await expect(code).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/u)
  if (goal) await configureGoal(player.page, goal)
  return (await code.textContent())!
}

export async function configureGoal(page: Page, goal: GoalSetup): Promise<void> {
  await page.locator(`[data-goal-type="${goal.type}"]`).click()
  if (goal.type === 'target-score' && goal.target !== undefined) {
    const input = page.locator('#goal-target-input')
    await input.fill(String(goal.target))
    await input.dispatchEvent('change')
    await expect(input).toHaveValue(String(Math.max(10, Math.min(100_000_000, goal.target))))
  }
  if (goal.type === 'timed' && goal.durationSec !== undefined) {
    const input = page.locator('#goal-duration-input')
    await input.fill(String(goal.durationSec))
    await input.dispatchEvent('change')
    await expect(input).toHaveValue(String(Math.max(10, Math.min(600, goal.durationSec))))
  }
}

export async function joinRoom(player: GamePlayer, code: string): Promise<void> {
  await player.page.locator('#room-code-input').fill(code)
  await player.page.getByRole('button', { name: 'Join', exact: true }).click()
}

/** The creator's Start button, shown once the second player is in. */
export async function startRoom(creator: GamePlayer): Promise<void> {
  await creator.page.locator('#room-start-btn').click()
}

export async function waitForPlaying(player: GamePlayer, timeout = 12_000): Promise<void> {
  await expect(player.page.locator('.playing-screen')).toBeVisible({ timeout })
}

export async function waitForEnded(player: GamePlayer, timeout = 20_000): Promise<void> {
  await expect(player.page.locator('.end-screen')).toBeVisible({ timeout })
}

export async function startRoomMatch(
  creator: GamePlayer,
  joiner: GamePlayer,
  goal: GoalSetup,
): Promise<string> {
  const code = await createRoom(creator, goal)
  await joinRoom(joiner, code)
  await startRoom(creator)
  await Promise.all([waitForPlaying(creator), waitForPlaying(joiner)])
  return code
}

/**
 * Both players rematch from the end screen of a room match: they land back in
 * their room, and the creator starts the next round.
 */
export async function rematchRoomMatch(creator: GamePlayer, joiner: GamePlayer): Promise<void> {
  await creator.page.locator('#rematch-btn').click()
  await joiner.page.locator('#rematch-btn').click()
  await expect(creator.page.locator('#room-start-btn')).toBeVisible()
  await startRoom(creator)
  await Promise.all([waitForPlaying(creator), waitForPlaying(joiner)])
}

export async function startBotMatch(player: GamePlayer, goal: GoalSetup): Promise<void> {
  await createRoom(player, goal)
  await player.page.locator('#room-bot-btn').click()
  await waitForPlaying(player)
}

export async function openPanel(page: Page, index: number): Promise<void> {
  const tab = page.locator(`#tab-${index}`)
  await expect(tab).not.toHaveAttribute('aria-disabled', 'true')
  // State broadcasts can replace the tab DOM while WebKit is waiting for click
  // stability. Invoke the current button directly; panel-specific tests assert
  // the resulting selection, while pointer behavior is covered separately.
  await tab.evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

export async function buyUpgrade(page: Page, upgradeId: string): Promise<void> {
  await openPanel(page, 1)
  const node = page.locator(`[data-upgrade="${upgradeId}"]`)
  await expect(node).toBeVisible()
  await node.click()
  const buy = page.locator('#upgrade-detail-buy')
  await expect(buy).toBeEnabled()
  await buy.click()
  await expect(page.locator('#upgrade-detail')).toHaveCount(0)
  await expect(node).toHaveClass(/owned/u)
}

export function ownScore(page: Page) {
  return page.locator('#player-score, #player-bar-score')
}

export function opponentScore(page: Page) {
  return page.locator('#opponent-score, #opponent-bar-score')
}

export async function unlockClicking(page: Page): Promise<void> {
  await buyUpgrade(page, 'sc-unlock')
  await openPanel(page, 0)
  await expect(page.locator('#click-btn-r0')).toBeVisible()
}

/**
 * Click Wood until the header shows more than `amount` (keep it under 1000, where
 * the header prints plain digits). Clicking must already be unlocked. The clicks
 * run in-page, three per 200 ms, so they stay under the server's 20 clicks/s cap
 * however slow the browser round-trip is.
 */
export async function earn(page: Page, amount: number): Promise<void> {
  await openPanel(page, 0)
  await page.waitForFunction(
    (target) => {
      if (Number(document.getElementById('header-r0')?.textContent) > target) return true
      const button = document.getElementById('click-btn-r0') as HTMLButtonElement
      for (let i = 0; i < 3; i += 1) button.click()
      return false
    },
    amount,
    { polling: 200, timeout: 60_000 },
  )
}

export async function finishTargetMatch(player: GamePlayer): Promise<void> {
  await unlockClicking(player.page)
  const click = player.page.locator('#click-btn-r0')
  await click.evaluate((button) => {
    for (let i = 0; i < 10; i += 1) (button as HTMLButtonElement).click()
  })
  await waitForEnded(player)
}
