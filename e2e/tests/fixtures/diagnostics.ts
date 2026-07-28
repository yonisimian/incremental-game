import type { Page, TestInfo } from '@playwright/test'

interface DiagnosticEvent {
  readonly kind: 'console' | 'pageerror' | 'requestfailed'
  readonly text: string
}

export class PageDiagnostics {
  private readonly events: DiagnosticEvent[] = []
  private readonly allowed: RegExp[] = []

  constructor(
    private readonly page: Page,
    private readonly label: string,
  ) {
    page.on('console', (message) => {
      if (message.type() === 'error') {
        this.events.push({ kind: 'console', text: message.text() })
      }
    })
    page.on('pageerror', (error) => {
      this.events.push({ kind: 'pageerror', text: error.stack ?? error.message })
    })
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown failure'
      this.events.push({
        kind: 'requestfailed',
        text: `${request.method()} ${request.url()}: ${failure}`,
      })
    })
  }

  allow(...patterns: RegExp[]): void {
    this.allowed.push(...patterns)
  }

  async assertClean(testInfo: TestInfo): Promise<void> {
    const unexpected = this.events.filter(
      (event) => !this.allowed.some((pattern) => pattern.test(event.text)),
    )
    if (this.events.length > 0) {
      await testInfo.attach(`diagnostics-${this.label}`, {
        body: JSON.stringify(
          {
            page: this.page.url(),
            events: this.events,
            unexpected,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      })
    }
    if (unexpected.length > 0) {
      throw new Error(
        `Unexpected browser diagnostics for ${this.label}:\n${unexpected
          .map((event) => `- ${event.kind}: ${event.text}`)
          .join('\n')}`,
      )
    }
  }
}
