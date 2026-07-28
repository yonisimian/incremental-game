import { test as base, expect } from '@playwright/test'
import type { Browser, TestInfo } from '@playwright/test'
import { GamePlayer } from './player.js'

class PlayerPool {
  private readonly created: { player: GamePlayer; ownsContext: boolean }[] = []

  constructor(
    private readonly browser: Browser,
    private readonly projectName: string,
  ) {}

  async create(name?: string): Promise<GamePlayer> {
    const player = await GamePlayer.create(this.browser, this.projectName, name)
    this.created.push({ player, ownsContext: true })
    return player
  }

  async createInContext(owner: GamePlayer, name: string): Promise<GamePlayer> {
    const player = await GamePlayer.createInContext(owner.context, name)
    this.created.push({ player, ownsContext: false })
    return player
  }

  async finish(testInfo: TestInfo): Promise<void> {
    const results = []
    for (const { player, ownsContext } of [...this.created].reverse()) {
      try {
        await player.finish(testInfo, ownsContext)
      } catch (error) {
        results.push(error)
      }
    }
    if (results.length > 0) throw results[0]
  }
}

interface Fixtures {
  readonly players: PlayerPool
}

export const test = base.extend<Fixtures>({
  players: async ({ browser }, use, testInfo) => {
    const pool = new PlayerPool(browser, testInfo.project.name)
    try {
      await use(pool)
    } finally {
      await pool.finish(testInfo)
    }
  },
})

export { expect }
