import { defineConfig, devices } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from './e2e/constants';
import { FLAG_MATRIX, type ExperimentFlagsOption } from './e2e/fixtures/experiment-flags';

const chromium = {
  ...devices['Desktop Chrome'],
  colorScheme: 'dark' as const,
  viewport: null,
  deviceScaleFactor: undefined,
  launchOptions: {
    args: ['--disable-blink-features=AutomationControlled'],
  },
};

/**
 * Tests that change state of the shared test account (like / dislike the same video) must never run at the same
 * time. They run in one single-worker project, once per flag set (see like-dislike.spec.ts); the flag matrix
 * projects skip them.
 */
const ACCOUNT_MUTATION_TESTS = /like-dislike\.spec\.ts$/;

/** Parallel workers on CI: the runner task has 8 vCPU / 16 GB (terraform/variables.tf runner_cpu/memory). */
const CI_WORKERS = 8;

export default defineConfig<{ experimentFlags: ExperimentFlagsOption }>({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: process.env.CI ? CI_WORKERS : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'https://www.youtube.com',
    // CI: keep a trace of the first (failed) attempt so flakes that pass on retry are still diagnosable;
    // the trace covers every page in the context, including the PiP window.
    trace: process.env.CI ? 'retain-on-first-failure' : 'on-first-retry',
    video: 'on-first-retry',
    actionTimeout: E2E_WAIT_TIMEOUT_MS,
  },
  // Experiment matrix (e2e/fixtures/experiment-flags.ts FLAG_MATRIX). Run a single cell locally with e.g.
  // `npx playwright test --project=chromium`; account-mutating tests with `--project=account-mutations`.
  projects: [
    ...FLAG_MATRIX.map(({ name, flags }) => ({
      name,
      testIgnore: ACCOUNT_MUTATION_TESTS,
      use: { ...chromium, experimentFlags: flags },
    })),
    {
      name: 'account-mutations',
      testMatch: ACCOUNT_MUTATION_TESTS,
      workers: 1,
      use: { ...chromium },
    },
  ],
});
