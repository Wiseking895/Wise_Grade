import { defineConfig, devices } from '@playwright/test'

/**
 * Phase 6C browser-QA configuration.
 *
 * The suite runs the real frontend against the real API, which in turn uses the
 * dedicated TEST_DATABASE_URL database. Ports are isolated (4100/5174) so a
 * normal development server is never touched. Fixtures are seeded by the
 * global setup and removed by `npm run phase6c:cleanup` in ../backend after the
 * run.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '.artifacts/phase6c/playwright-report',
        open: 'never',
      },
    ],
  ],
  outputDir: '.artifacts/phase6c/test-results',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm --prefix ../backend run phase6c:serve',
      url: 'http://localhost:4100/api/health',
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -- --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 180_000,
      env: { VITE_API_URL: 'http://localhost:4100' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
