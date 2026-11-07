/**
 * Playwright fixtures: PiP stub + handler stub injected via addInitScript.
 * Composes modules from ./auth, ./handler-stub, and defines page/PiP fixtures.
 */
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import {
  E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
  E2E_PAGE_HYDRATION_TIMEOUT_MS,
  E2E_PIP_AD_MAX_WAIT_MS,
  E2E_PIP_AD_STABILITY_MS,
  E2E_PIP_SKIP_AD_POLL_MS,
  E2E_WAIT_TIMEOUT_MS,
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
  openContextMenuInPip,
  waitForContextMenuItemVisible,
} from './pip-context-menu';
export {
  waitForShortsPlayerVisibleInMain,
  waitForShortsPlayerVisibleInPip,
  scrollToNextShortInPip,
} from './pip-shorts';

/**
 * Userscript initialized and the watch page hydrated. On slow runners the page is still a skeleton after the
 * consent reload when the userscript is ready; triggering PiP or pressing 'i' then does nothing because YouTube
 * drops miniplayer activation without a watch response.
 */
async function waitForWatchPageReady(page: Page): Promise<void> {
  await page.waitForFunction(
    ({ hydratedSel }) => !!window.__E2E_PIP__?.ready() && !!document.querySelector(hydratedSel),
    { hydratedSel: E2E_SELECTORS.WATCH_PAGE_HYDRATED },
    { timeout: E2E_PAGE_HYDRATION_TIMEOUT_MS }
  );
}

export const test = base.extend<{
  authState: AuthStateOption;
  storeAuthState: StoreAuthStateOption;
  experimentFlags: ExperimentFlagsOption;
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

  context: async (
    { userscriptBody, browser, authState, storeAuthState, experimentFlags },
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
      await ctx.addInitScript(initHandlerStub, userscriptBody);
      await ctx.addInitScript(installMiniplayerTimeline, MINIPLAYER_TIMELINE_LIMITS);
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
      await use();
      if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
      const timeline = await readMiniplayerTimeline(page);
      console.log(`\n[mini player timeline] ${testInfo.titlePath.join(' › ')}\n${timeline}\n`);
      await testInfo.attach('miniplayer-timeline', { body: timeline, contentType: 'text/plain' });
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
    const isAdOverlayGone = (page: Page) =>
      page.evaluate((adOverlaySel: string) => {
        const pip = window.documentPictureInPicture?.window;
        const overlay = pip?.document.querySelector(adOverlaySel);
        if (!overlay) return true;
        const style = pip?.document.defaultView?.getComputedStyle(overlay);
        return style?.display === 'none' || overlay.getBoundingClientRect().height === 0;
      }, E2E_SELECTORS.AD_PLAYER_OVERLAY);

    const tryClickSkipAdInPip = async (page: Page): Promise<boolean> => {
      const ctx = page.context();
      const pages = ctx.pages();
      for (const p of pages) {
        if (p === page) continue;
        const loc = p.locator(E2E_SELECTORS.SKIP_AD_BUTTON);
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
            .waitForFunction(
              (adOverlaySel: string) => {
                const pip = window.documentPictureInPicture?.window;
                const overlay = pip?.document.querySelector(adOverlaySel);
                if (!overlay) return true;
                const style = pip?.document.defaultView?.getComputedStyle(overlay);
                return style?.display === 'none' || overlay.getBoundingClientRect().height === 0;
              },
              E2E_SELECTORS.AD_PLAYER_OVERLAY,
              { timeout: Math.max(remaining, 1) }
            )
            .then(() => true)
            .catch(() => false);
          if (!ended) {
            throw new Error(`Ads in PiP did not end within ${E2E_PIP_AD_MAX_WAIT_MS}ms`);
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
