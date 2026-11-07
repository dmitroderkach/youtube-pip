import { defineConfig, devices } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from './e2e/constants';
import {
  ALL_EXPERIMENT_FLAGS,
  EXPERIMENT_FLAG_SETS,
  type ExperimentFlagsOption,
} from './e2e/fixtures/experiment-flags';

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
 * Experiment matrix: every project runs the whole suite with one set of forced YouTube experiment flags,
 * so rollout-specific breakages show up deterministically (docs/YOUTUBE_EXPERIMENT_FLAGS.md).
 * Run a single cell locally with e.g. `npx playwright test --project=chromium`.
 */
const FLAG_MATRIX: { name: string; flags: string[] }[] = [
  { name: 'chromium', flags: EXPERIMENT_FLAG_SETS.NONE },
  { name: 'chromium-yt-pip', flags: [...EXPERIMENT_FLAG_SETS.YT_PIP] },
  { name: 'chromium-cow-player', flags: [...EXPERIMENT_FLAG_SETS.COW_PLAYER] },
  { name: 'chromium-legacy-ui', flags: [...EXPERIMENT_FLAG_SETS.LEGACY_UI] },
  { name: 'chromium-all-flags', flags: ALL_EXPERIMENT_FLAGS },
];

export default defineConfig<{ experimentFlags: ExperimentFlagsOption }>({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'https://www.youtube.com',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    actionTimeout: E2E_WAIT_TIMEOUT_MS,
  },
  projects: FLAG_MATRIX.map(({ name, flags }) => ({
    name,
    use: { ...chromium, experimentFlags: flags },
  })),
});
