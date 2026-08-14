import { defineConfig, devices } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // Distribute individual tests (not whole files) across workers so one long
  // spec file can't pin a worker and stretch the tail. Each test still runs
  // alone on its worker, so the worker-scoped `gameServer` stays single-tenant.
  fullyParallel: true,
  // Each worker drives a real browser (two contexts for two-player tests) plus
  // its own game server. Locally, 4 workers keeps the heaviest engine (WebKit)
  // fed without oversubscribing the CPU into spurious timeouts. In CI each
  // browser runs as its own single-project job, so half the runner's cores is
  // the safe default there.
  workers: process.env.CI ? '50%' : 4,
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  forbidOnly: CI,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: CI
    ? [['line'], ['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Only the stateless Vite preview is shared across workers; each worker boots
  // its own game server on an ephemeral port via the `gameServer` fixture.
  webServer: {
    command: 'pnpm --filter client exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    cwd: ROOT,
    url: 'http://127.0.0.1:4173/',
    timeout: 20_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/mobile.spec.ts'],
      grepInvert: /@extended/u,
    },
    {
      name: 'chromium-extended',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/mobile.spec.ts'],
      grep: /@extended/u,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: ['**/mobile.spec.ts'],
      grepInvert: [/@extended/u, /@chromium-only/u],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ['**/mobile.spec.ts'],
      grepInvert: [/@extended/u, /@chromium-only/u],
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: '**/mobile.spec.ts',
    },
  ],
})
