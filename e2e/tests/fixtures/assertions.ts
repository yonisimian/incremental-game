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

/** Prove a sampled value remains equal to `expected` for the full observation window. */
export async function expectUnchanged<T>(
  sample: () => T | Promise<T>,
  expected: T,
  observationMs = 550,
  intervalMs = 50,
): Promise<void> {
  const started = performance.now()
  const samples: { readonly elapsedMs: number; readonly value: T }[] = []
  while (performance.now() - started < observationMs) {
    samples.push({
      elapsedMs: Math.round(performance.now() - started),
      value: await sample(),
    })
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  expect(
    samples.every(({ value }) => Object.is(value, expected)),
    `Observed values: ${JSON.stringify(samples)}`,
  ).toBe(true)
}

export function displayedNumber(text: string | null): number {
  if (!text) return Number.NaN
  const match = /-?\d+(?:[.,]\d+)?/u.exec(text)
  return match ? Number(match[0].replace(',', '.')) : Number.NaN
}
