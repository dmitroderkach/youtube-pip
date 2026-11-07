/**
 * Optional runtime gate for auth-backed e2e tests.
 * Set env `SKIP_AUTH_E2E_ON_CI=true` to skip tests that opt into `authState: true`.
 * Intended for CI toggling via GitHub Variables without code changes.
 */
export const SKIP_AUTH_E2E_ON_CI = String(process.env.SKIP_AUTH_E2E_ON_CI).toLowerCase() === 'true';

/** Default timeout for all e2e wait operations (ms). */
export const E2E_WAIT_TIMEOUT_MS = 10000;

/** Timeout for the watch page to hydrate after load / consent reload (slow on CI runners). */
export const E2E_PAGE_HYDRATION_TIMEOUT_MS = 30_000;

/** Page-ready attempts when YouTube reloads the document during the wait ("Execution context was destroyed"). */
export const E2E_PAGE_READY_ATTEMPTS = 3;

/**
 * YouTube scheduler: low priority (Kevlar addLowPriorityJob) and the delay of the watch-while
 * IntersectionObserver job. Mirrors YT_SCHEDULER in src/constants/youtube.ts.
 */
export const E2E_YT_SCHEDULER = { LOW_PRIORITY: 1, WATCH_WHILE_JOB_DELAY_MS: 100 } as const;

/** Max wait for YouTube's pending low-priority jobs after the page is ready (held back ~2-3 s on CI). */
export const E2E_YT_LOW_PRIORITY_JOBS_TIMEOUT_MS = 10_000;

/** Timeout for context menu item visibility (ads can be longer than 5s). */
export const E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS = 30_000;

/**
 * Retry interval for opening the context menu in PiP. Right after a menu closes, YouTube's player
 * still treats it as open during its fade-out and ignores the next right-click; we right-click again.
 */
export const E2E_CONTEXT_MENU_REOPEN_INTERVAL_MS = 500;

/** Total time for ads in PiP to end (several unskippable ads in a row are common on CI). */
export const E2E_PIP_AD_MAX_WAIT_MS = 75_000;

/** Video time (s) the player must reach before "Copy video URL at current time" (YouTube omits t= near 0). */
export const E2E_MIN_PLAYBACK_TIME_FOR_URL_AT_TIME_S = 2;

/** How long the ad overlay must stay gone to consider all ads finished (YouTube can show 2+). */
export const E2E_PIP_AD_STABILITY_MS = 500;

/** Poll interval to click "Skip ad" in PiP (button appears after a few seconds). */
export const E2E_PIP_SKIP_AD_POLL_MS = 500;

/**
 * Copy items in the player context menu, counted from the end (0 = "Stats for nerds"). Optional items above
 * them (Loop, Miniplayer, Picture-in-picture) depend on experiment flags, so absolute indices are not stable.
 * Mirrors COPY_MENU_POSITIONS_FROM_END in src/constants/ui.ts.
 */
export const COPY_MENU_POSITIONS_FROM_END = {
  VIDEO_URL: 5,
  URL_AT_TIME: 4,
  EMBED: 3,
  DEBUG_INFO: 2,
} as const;
