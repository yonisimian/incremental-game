import { devices, expect } from '@playwright/test'
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  TestInfo,
} from '@playwright/test'
import { PageDiagnostics } from './diagnostics.js'

let nextPlayer = 1

function contextOptions(projectName: string): BrowserContextOptions {
  return projectName === 'mobile-chromium'
    ? { ...devices['Pixel 7'] }
    : { viewport: { width: 1280, height: 800 } }
}

export class GamePlayer {
  readonly diagnostics: PageDiagnostics

  private constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    readonly name: string,
  ) {
    this.diagnostics = new PageDiagnostics(page, name)
  }

  static async create(
    browser: Browser,
    projectName: string,
    requestedName?: string,
  ): Promise<GamePlayer> {
    const name = requestedName ?? `E2E-${nextPlayer++}`
    const context = await browser.newContext(contextOptions(projectName))
    const page = await context.newPage()
    return new GamePlayer(context, page, name)
  }

  static async createInContext(
    context: BrowserContext,
    requestedName: string,
  ): Promise<GamePlayer> {
    const page = await context.newPage()
    return new GamePlayer(context, page, requestedName)
  }

  async open(path = '/'): Promise<void> {
    await this.page.goto(path)
    await expect(this.page.getByRole('button', { name: /Quick Match/u })).toBeVisible()
    const input = this.page.locator('#name-input')
    await input.fill(this.name)
    await expect(input).toHaveValue(this.name.slice(0, 16))
  }

  allowDiagnostics(...patterns: RegExp[]): void {
    this.diagnostics.allow(...patterns)
  }

  async finish(testInfo: TestInfo, closeContext = true): Promise<void> {
    try {
      await this.diagnostics.assertClean(testInfo)
    } finally {
      if (closeContext) await this.context.close()
      else await this.page.close()
    }
  }
}
