/**
 * Playwright fixtures: PiP stub + handler stub injected via addInitScript.
 * Composes modules from ./auth, ./handler-stub, and defines page/PiP fixtures.
 */
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import {
  E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
  E2E_PAGE_HYDRATION_TIMEOUT_MS,
  E2E_PAGE_READY_ATTEMPTS,
  E2E_PIP_AD_MAX_WAIT_MS,
  E2E_PIP_AD_STABILITY_MS,
  E2E_PIP_SKIP_AD_POLL_MS,
  E2E_WAIT_TIMEOUT_MS,
  E2E_YT_LOW_PRIORITY_JOBS_TIMEOUT_MS,
  E2E_YT_SCHEDULER,
  SKIP_AUTH_E2E_ON_CI,
} from '../constants';
import { E2E_SELECTORS } from '../selectors';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  E2E_STORAGE_STATE_PATH,
  ensureStorageStateFromSecret,
  type AuthStateOption,
  type StoreAuthStateOption,
} from './auth';
import { getUserscriptBody, initHandlerStub } from './handler-stub';
import { installAdBlock, type BlockAdsOption } from './block-ads';
import {
  installMiniplayerTimeline,
  MINIPLAYER_TIMELINE_LIMITS,
  readMiniplayerTimeline,
} from './miniplayer-timeline';
import {
  FORCED_EXPERIMENT_FLAGS,
  installForcedExperimentFlags,
  type ExperimentFlagsOption,
} from './experiment-flags';

const defaultContextOptions = {
  viewport: null,
  colorScheme: 'dark' as const,
  deviceScaleFactor: undefined,
  baseURL: 'https://www.youtube.com',
};

/** localStorage flag that turns on userscript debug logs (src/constants/app.ts DEBUG_FLAG). */
const USERSCRIPT_DEBUG_FLAG = 'YOUTUBE_PIP_DEBUG';
/** Tag in every userscript log line (src/logger.ts). */
const USERSCRIPT_LOG_TAG = '[YouTube PiP]';
/** Userscript log lines kept for the failure output. */
const USERSCRIPT_LOG_MAX_LINES = 300;
const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Shorts feed page with vertical reels. */
const SHORTS_URL = 'https://www.youtube.com/shorts';
const CONSENT_ACCEPT_BUTTON_NAME_RE = /Accept (the use of cookies and|all)/i;

/** Video in a playlist (mix/radio) so mini player shows playlist and expand works. */
export const PLAYLIST_VIDEO_URL =
  'https://www.youtube.com/watch?v=c9R9VsK54ZQ&list=RDc9R9VsK54ZQ&start_radio=1';

type AcceptYouTubeConsentFn = (page: Page) => Promise<void>;
type TriggerEnterPictureInPictureFn = (page: Page) => Promise<void>;
type AssertPiPWindowHasPlayerFn = (page: Page) => Promise<void>;
type WaitForPiPAdToEndFn = (page: Page) => Promise<void>;

export { E2E_STORAGE_STATE_PATH, type AuthStateOption, type StoreAuthStateOption };
export {
  clickExpandInPip,
  clickPlaylistItemInPip,
  waitForMiniPlayerVisibleInPip,
  waitForPlaylistItemSelectedInPip,
  waitForPlaylistItemVisibleInPip,
  waitForPlaylistPanelVisibleInPip,
} from './pip-playlist';
export {
  clickLikeDislikeInPip,
  type LikeDislikeAction,
  waitForLikeButtonsVisibleInPip,
  waitForLikeDislikeAriaPressedInPip,
} from './pip-like-dislike';
export {
  clickContextMenuItem,
  clickCopyMenuItemInPip,
  focusContextMenuItemInPip,
  focusedContextMenuItemPositionInPip,
  watchCopiedBezelInPip,
  waitForCopyFeedbackInPip,
  openContextMenuInPip,
  waitForContextMenuItemVisible,
} from './pip-context-menu';
export { waitForPlaybackTimeInPip, type PlaybackWaitResult } from './pip-playback';
export {
  waitForShortsPlayerVisibleInMain,
  waitForShortsPlayerVisibleInPip,
  scrollToNextShortInPip,
} from './pip-shorts';

/**
 * Userscript initialized and the watch page has its watch response. On slow runners the page is still a skeleton
 * after the consent reload when the userscript is ready; triggering PiP or pressing 'i' then does nothing because
 * YouTube drops mini player activation without a watch response.
 */
async function waitForWatchPageReady(page: Page): Promise<void> {
  // YouTube sometimes reloads the document right after load (seen with playlist URLs); evaluate() then fails with
  // "Execution context was destroyed". The new document needs the whole wait again (userscript re-inits).
  for (let attempt = 1; ; attempt++) {
    try {
      await page.waitForFunction(
        ({ watchSel }) => {
          const watch = document.querySelector(watchSel) as
            | (Element & { data?: { currentVideoEndpoint?: unknown } })
            | null;
          return !!window.__E2E_PIP__?.ready() && !!watch?.data?.currentVideoEndpoint;
        },
        { watchSel: E2E_SELECTORS.WATCH_PAGE },
        { timeout: E2E_PAGE_HYDRATION_TIMEOUT_MS }
      );
      await waitForYouTubeLowPriorityJobs(page);
      return;
    } catch (error) {
      const destroyedByNavigation =
        error instanceof Error && /Execution context was destroyed/.test(error.message);
      if (!destroyedByNavigation || attempt >= E2E_PAGE_READY_ATTEMPTS) throw error;
      await page.waitForLoadState('domcontentloaded');
    }
  }
}

/**
 * Wait until YouTube has run the low-priority jobs queued so far (same barrier as the userscript's
 * YouTubeScheduler.waitForLowPriorityJobs). With kevlar_watch_while_v2 the watch page's first IntersectionObserver
 * callback queues a job that deactivates an active mini player; on CI YouTube holds it back for ~2-3 s, so a mini
 * player activated right after page load ('i' or PiP) was dropped ~100 ms after it appeared.
 */
async function waitForYouTubeLowPriorityJobs(page: Page): Promise<void> {
  await page.evaluate(
    ({ priority, delayMs, timeoutMs }) =>
      new Promise<void>((resolve) => {
        const addJob = window.yt?.scheduler?.instance?.addJob;
        if (typeof addJob !== 'function') return resolve();
        const timeoutId = setTimeout(resolve, timeoutMs);
        addJob(
          () => {
            clearTimeout(timeoutId);
            resolve();
          },
          priority,
          delayMs
        );
      }),
    {
      priority: E2E_YT_SCHEDULER.LOW_PRIORITY,
      delayMs: E2E_YT_SCHEDULER.WATCH_WHILE_JOB_DELAY_MS,
      timeoutMs: E2E_YT_LOW_PRIORITY_JOBS_TIMEOUT_MS,
    }
  );
}

export const test = base.extend<{
  authState: AuthStateOption;
  storeAuthState: StoreAuthStateOption;
  experimentFlags: ExperimentFlagsOption;
  blockAds: BlockAdsOption;
  userscriptBody: string;
  acceptYouTubeConsent: AcceptYouTubeConsentFn;
  videoPageReady: Page;
  playlistVideoPageReady: Page;
  shortsPageReady: Page;
  triggerEnterPictureInPicture: TriggerEnterPictureInPictureFn;
  assertPiPWindowHasPlayer: AssertPiPWindowHasPlayerFn;
  waitForPiPAdToEnd: WaitForPiPAdToEndFn;
  miniplayerTimelineOnFailure: void;
}>({
  authState: [undefined, { option: true }],
  storeAuthState: [undefined, { option: true }],
  experimentFlags: [[], { option: true }],
  blockAds: [false, { option: true }],

  context: async (
    { userscriptBody, browser, authState, storeAuthState, experimentFlags, blockAds },
    use,
    testInfo: TestInfo
  ) => {
    if (authState === true && SKIP_AUTH_E2E_ON_CI) {
      testInfo.skip(true, 'Auth-backed e2e skipped: SKIP_AUTH_E2E_ON_CI=true in CI configuration.');
    }

    const addInitAndUse = async (ctx: Awaited<ReturnType<typeof browser.newContext>>) => {
      // Project flag set (playwright.config.ts matrix) plus any ad-hoc E2E_FORCE_EXPERIMENT_FLAGS
      const flags = [...new Set([...experimentFlags, ...FORCED_EXPERIMENT_FLAGS])];
      if (flags.length > 0) {
        await ctx.addInitScript(installForcedExperimentFlags, flags);
      }
      // Userscript debug logs on (before it runs): they land in traces and in the failure output below
      await ctx.addInitScript((flag: string) => {
        try {
          localStorage.setItem(flag, 'true');
        } catch {
          /* opaque origins (about:blank frames) */
        }
      }, USERSCRIPT_DEBUG_FLAG);
      await ctx.addInitScript(initHandlerStub, userscriptBody);
      await ctx.addInitScript(installMiniplayerTimeline, MINIPLAYER_TIMELINE_LIMITS);
      if (blockAds) await ctx.addInitScript(installAdBlock);
      await use(ctx);
      if (storeAuthState === true) {
        mkdirSync(dirname(E2E_STORAGE_STATE_PATH), { recursive: true });
        await ctx.storageState({ path: E2E_STORAGE_STATE_PATH });
      }
      await ctx.close();
    };

    if (authState === true) {
      ensureStorageStateFromSecret();
      if (existsSync(E2E_STORAGE_STATE_PATH)) {
        const ctx = await browser.newContext({
          storageState: E2E_STORAGE_STATE_PATH,
          ...defaultContextOptions,
        });
        await addInitAndUse(ctx);
        return;
      }
    }

    const ctx = await browser.newContext(defaultContextOptions);
    await addInitAndUse(ctx);
  },

  /** On failure, print and attach the mini player timeline (see miniplayer-timeline.ts) for CI flakes. */
  miniplayerTimelineOnFailure: [
    async ({ page }, use, testInfo) => {
      // Userscript log lines of the main page (PiP logs go through the main window's console too)
      const userscriptLog: string[] = [];
      page.on('console', (msg) => {
        const text = msg.text();
        if (!text.includes(USERSCRIPT_LOG_TAG)) return;
        userscriptLog.push(
          text
            .replace(/%c/g, '')
            .replace(/\s*(?:color|font-weight):[^;]*;/g, '')
            // global metadata repeated on every line
            .replace(/\s*\{youtubeVersion:[^}]*\}\s*$/, '')
        );
        if (userscriptLog.length > USERSCRIPT_LOG_MAX_LINES) userscriptLog.shift();
      });
      await use();
      if (testInfo.status === testInfo.expectedStatus) return;
      const timeline = page.isClosed() ? 'page closed' : await readMiniplayerTimeline(page);
      const log = userscriptLog.join('\n');
      console.log(
        `\n[mini player timeline] ${testInfo.titlePath.join(' › ')}\n${timeline}\n` +
          `\n[userscript log] ${testInfo.titlePath.join(' › ')}\n${log}\n`
      );
      await testInfo.attach('miniplayer-timeline', { body: timeline, contentType: 'text/plain' });
      await testInfo.attach('userscript-log', { body: log, contentType: 'text/plain' });
    },
    { auto: true },
  ],

  userscriptBody: async ({}, use) => {
    await use(getUserscriptBody());
  },

  acceptYouTubeConsent: async ({ authState }, use) => {
    const accept: AcceptYouTubeConsentFn = async (page) => {
      if (authState === true || page.isClosed()) return;

      const acceptButton = page.getByRole('button', {
        name: CONSENT_ACCEPT_BUTTON_NAME_RE,
      });
      const appeared = await acceptButton
        .waitFor({ state: 'visible', timeout: E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!appeared) return;

      await Promise.all([
        // YouTube may refresh after consent click.
        page
          .waitForEvent('domcontentloaded', { timeout: E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS })
          .catch(() => undefined),
        acceptButton.click(),
      ]);
    };
    await use(accept);
  },

  videoPageReady: async ({ page, acceptYouTubeConsent }, use) => {
    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded' });
    await acceptYouTubeConsent(page);
    await waitForWatchPageReady(page);
    await use(page);
  },

  playlistVideoPageReady: async ({ page, acceptYouTubeConsent }, use) => {
    await page.goto(PLAYLIST_VIDEO_URL, { waitUntil: 'domcontentloaded' });
    await acceptYouTubeConsent(page);
    await waitForWatchPageReady(page);
    await use(page);
  },

  shortsPageReady: async ({ page, acceptYouTubeConsent }, use) => {
    await page.goto(SHORTS_URL, { waitUntil: 'domcontentloaded' });
    await acceptYouTubeConsent(page);
    await page.waitForFunction(
      ({ shortsSel }) => !!window.__E2E_PIP__?.ready() && !!document.querySelector(shortsSel),
      { shortsSel: E2E_SELECTORS.YTD_SHORTS },
      { timeout: E2E_WAIT_TIMEOUT_MS }
    );
    await use(page);
  },

  triggerEnterPictureInPicture: async ({}, use) => {
    const trigger: TriggerEnterPictureInPictureFn = (page) =>
      page.evaluate(() => window.__E2E_PIP__!.trigger('enterpictureinpicture'));
    await use(trigger);
  },

  assertPiPWindowHasPlayer: async ({}, use) => {
    const assertFn: AssertPiPWindowHasPlayerFn = async (page) => {
      await page.waitForFunction(
        ({ ytdApp, moviePlayer }: { ytdApp: string; moviePlayer: string }) => {
          const pipWindow = window.documentPictureInPicture?.window;
          if (!pipWindow?.document) return false;
          return !!(
            pipWindow.document.querySelector(ytdApp) &&
            pipWindow.document.querySelector(moviePlayer)
          );
        },
        { ytdApp: E2E_SELECTORS.YTD_APP, moviePlayer: E2E_SELECTORS.MOVIE_PLAYER },
        { timeout: E2E_WAIT_TIMEOUT_MS }
      );
    };
    await use(assertFn);
  },

  waitForPiPAdToEnd: async ({}, use) => {
    const adSelectors = {
      overlaySel: E2E_SELECTORS.AD_PLAYER_OVERLAY,
      adPlayerSel: E2E_SELECTORS.AD_SHOWING_PLAYER,
    };
    /** In the page: no player in PiP shows an ad (`ad-showing`, any ad UI) and the ad overlay is hidden. */
    const adGoneInPip = ({ overlaySel, adPlayerSel }: typeof adSelectors): boolean => {
      const pip = window.documentPictureInPicture?.window;
      if (!pip) return true;
      if (pip.document.querySelector(adPlayerSel)) return false;
      const overlay = pip.document.querySelector(overlaySel);
      if (!overlay) return true;
      return (
        pip.getComputedStyle(overlay).display === 'none' ||
        overlay.getBoundingClientRect().height === 0
      );
    };
    const isAdOverlayGone = (page: Page) => page.evaluate(adGoneInPip, adSelectors);
    /** What the ad UI in PiP looks like, for the timeout error (which skip button, if any). */
    const describeAdInPip = (page: Page) =>
      page
        .evaluate(({ adPlayerSel }: typeof adSelectors) => {
          const doc = window.documentPictureInPicture?.window?.document;
          if (!doc) return 'no PiP window';
          const skip = Array.from(doc.querySelectorAll<HTMLElement>('[class*="skip"]'))
            .slice(0, 6)
            .map(
              (e) => `${e.className.toString().slice(0, 60)}${e.offsetParent ? ' (visible)' : ''}`
            );
          const remaining = doc
            .querySelector('.ytp-ad-duration-remaining, .ytp-ad-text')
            ?.textContent?.trim();
          return (
            `ad-showing players: ${doc.querySelectorAll(adPlayerSel).length}; ` +
            `skip elements: ${skip.join(' | ') || 'none'}; ad text: ${remaining ?? 'none'}`
          );
        }, adSelectors)
        .catch((e: unknown) => `state unavailable: ${String(e)}`);

    const tryClickSkipAdInPip = async (page: Page): Promise<boolean> => {
      const ctx = page.context();
      const pages = ctx.pages();
      for (const p of pages) {
        if (p === page) continue;
        // First visible one: with several matches isVisible() would throw (strict) and read as "not visible"
        const loc = p.locator(`${E2E_SELECTORS.SKIP_AD_BUTTON} >> visible=true`).first();
        const visible = await loc.isVisible().catch(() => false);
        if (visible) {
          const clicked = await loc
            .click()
            .then(() => true)
            .catch(() => false);
          if (clicked) return true;
        }
      }
      return false;
    };

    /**
     * One deadline for all ads in a row (YouTube can show 2+ unskippable ones, together longer than 30s). A
     * timeout of a single wait used to throw on the first attempt, so the old attempt loop never retried.
     */
    const waitFn: WaitForPiPAdToEndFn = async (page) => {
      const deadline = Date.now() + E2E_PIP_AD_MAX_WAIT_MS;
      const skipPoll = setInterval(() => void tryClickSkipAdInPip(page), E2E_PIP_SKIP_AD_POLL_MS);
      try {
        for (;;) {
          const remaining = deadline - Date.now();
          const ended = await page
            .waitForFunction(adGoneInPip, adSelectors, { timeout: Math.max(remaining, 1) })
            .then(() => true)
            .catch(() => false);
          if (!ended) {
            throw new Error(
              `Ads in PiP did not end within ${E2E_PIP_AD_MAX_WAIT_MS}ms (${await describeAdInPip(page)})`
            );
          }
          await page.waitForTimeout(E2E_PIP_AD_STABILITY_MS);
          if (await isAdOverlayGone(page)) return;
        }
      } finally {
        clearInterval(skipPoll);
      }
    };
    await use(waitFn);
  },
});

export { expect };
