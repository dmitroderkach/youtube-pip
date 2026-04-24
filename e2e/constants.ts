/**
 * Optional runtime gate for auth-backed e2e tests.
 * Set env `SKIP_AUTH_E2E_ON_CI=true` to skip tests that opt into `authState: true`.
 * Intended for CI toggling via GitHub Variables without code changes.
 */
export const SKIP_AUTH_E2E_ON_CI = String(process.env.SKIP_AUTH_E2E_ON_CI).toLowerCase() === 'true';

/** Default timeout for all e2e wait operations (ms). */
export const E2E_WAIT_TIMEOUT_MS = 10000;

/** Timeout for context menu item visibility (ads can be longer than 5s). */
export const E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS = 30_000;

/** How long the ad overlay must stay gone to consider all ads finished (YouTube can show 2+). */
export const E2E_PIP_AD_STABILITY_MS = 500;

/** Poll interval to click "Skip ad" in PiP (button appears after a few seconds). */
export const E2E_PIP_SKIP_AD_POLL_MS = 500;
