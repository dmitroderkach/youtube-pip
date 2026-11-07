/**
 * Playwright config for the manual session (docs/MANUAL_SESSION.md): the e2e config (projects = experiment flag
 * matrix, browser options) with this folder as the test dir and no HTML report.
 */
import { defineConfig } from '@playwright/test';
import baseConfig from '../../playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: '.',
  retries: 0,
  reporter: [['list']],
});
