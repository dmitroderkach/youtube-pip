import { defineConfig, devices } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from './e2e/constants';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'https://www.youtube.com',
    // TEMP: keep trace for every run while stabilizing flaky consent flow.
    trace: 'on',
    video: 'on-first-retry',
    actionTimeout: E2E_WAIT_TIMEOUT_MS,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'dark',
        viewport: null,
        deviceScaleFactor: undefined,
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled'],
        },
      },
    },
  ],
});
