import type { Locator } from '@playwright/test'
import { expect } from '@playwright/test'

interface Sample {
  readonly elapsedMs: number
  readonly value: string
}

export async function expectStable(
  locator: Locator,
  observationMs = 550,
  intervalMs = 50,
): Promise<void> {
  const started = performance.now()
  const samples: Sample[] = []
  while (performance.now() - started < observationMs) {
    samples.push({
      elapsedMs: Math.round(performance.now() - started),
      value: (await locator.textContent()) ?? '',
    })
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  const values = new Set(samples.map((sample) => sample.value))
  expect(values.size, `Observed values: ${JSON.stringify(samples)}`).toBe(1)
}

export function displayedNumber(text: string | null): number {
  if (!text) return Number.NaN
  const match = /-?\d+(?:[.,]\d+)?/u.exec(text)
  return match ? Number(match[0].replace(',', '.')) : Number.NaN
}
