/**
 * Playwright fixtures: PiP stub + handler stub injected via addInitScript.
 * Stub implementation lives here; no Playwright scripts in scripts/.
 */
import { test as base, expect, type Page } from '@playwright/test';
import {
  E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
  E2E_PIP_AD_STABILITY_MS,
  E2E_PIP_SKIP_AD_POLL_MS,
  E2E_WAIT_TIMEOUT_MS,
} from './constants';
import { E2E_SELECTORS } from './selectors';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const projectRoot = join(process.cwd());

/** Path where cookies + localStorage are loaded from (no write-back on test end). When file is missing and E2E_STORAGE_STATE_BASE64 is set, the fixture creates it from the secret. */
export const E2E_STORAGE_STATE_PATH = join(projectRoot, 'e2e', '.auth', 'storageState.json');

/** Env var with base64-encoded Playwright storage state (GitHub secret). Used only when the file does not exist. */
const E2E_STORAGE_STATE_BASE64_ENV = 'E2E_STORAGE_STATE_BASE64';

/** If storage state file is missing and E2E_STORAGE_STATE_BASE64 is set, decode and write the file. */
function ensureStorageStateFromSecret(): void {
  if (existsSync(E2E_STORAGE_STATE_PATH)) return;
  const base64 = process.env[E2E_STORAGE_STATE_BASE64_ENV];
  if (!base64 || typeof base64 !== 'string') return;
  mkdirSync(dirname(E2E_STORAGE_STATE_PATH), { recursive: true });
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  writeFileSync(E2E_STORAGE_STATE_PATH, decoded, 'utf8');
}

const scriptPath = join(projectRoot, 'dist/userscript.js');

/** Handler stub: collects mediaSession.setActionHandler, exposes __E2E_PIP__.trigger/has. Runs in browser. */
function initHandlerStub(userscriptBody: string): void {
  function installE2EHandlerStub(): {
    trigger: (action: string) => Promise<void>;
    has: (action: string) => boolean;
  } {
    const handlers: Record<string, () => void | Promise<void>> = {};
    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaSession &&
      typeof navigator.mediaSession.setActionHandler === 'function'
    ) {
      const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = function (action: string, handler: unknown) {
        if (typeof action === 'string' && typeof handler === 'function')
          handlers[action] = handler as () => void | Promise<void>;
        return original(
          action as ExtendedMediaSessionAction,
          handler as MediaSessionActionHandler | null
        );
      };
    }
    const api = {
      trigger(action: string): Promise<void> {
        const fn = handlers[action];
        if (typeof fn !== 'function')
          return Promise.reject(new Error('No handler registered for action: ' + action));
        try {
          return Promise.resolve(fn() as Promise<void>);
        } catch (err) {
          return Promise.reject(err);
        }
      },
      has(action: string): boolean {
        return typeof handlers[action] === 'function';
      },
    };
    if (typeof globalThis !== 'undefined')
      (globalThis as unknown as { __E2E_PIP__: typeof api }).__E2E_PIP__ = api;
    return api;
  }
  installE2EHandlerStub();
  eval(userscriptBody);
}

function getUserscriptBody(): string {
  if (!existsSync(scriptPath)) {
    throw new Error('Run "npm run build" first. dist/userscript.js not found.');
  }
  const raw = readFileSync(scriptPath, 'utf8');
  return raw.replace(/^[\s\S]*?\/\/ ==\/UserScript==\s*\n?/m, '');
}

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Video in a playlist (mix/radio) so mini player shows playlist and expand works. */
export const PLAYLIST_VIDEO_URL =
  'https://www.youtube.com/watch?v=c9R9VsK54ZQ&list=RDc9R9VsK54ZQ&start_radio=1';

type AcceptYouTubeConsentFn = (page: Page) => Promise<void>;

type TriggerEnterPictureInPictureFn = (page: Page) => Promise<void>;

type AssertPiPWindowHasPlayerFn = (page: Page) => Promise<void>;

type WaitForPiPAdToEndFn = (page: Page) => Promise<void>;

const defaultContextOptions = {
  viewport: null,
  colorScheme: 'dark' as const,
  deviceScaleFactor: undefined,
  baseURL: 'https://www.youtube.com',
};

/** true = use E2E_STORAGE_STATE_PATH, false/undefined = isolated context. */
export type AuthStateOption = true | false | undefined;

export const test = base.extend<{
  /** test.use({ authState: true }) to load saved state, false/undefined for isolated context. */
  authState: AuthStateOption;
  userscriptBody: string;
  acceptYouTubeConsent: AcceptYouTubeConsentFn;
  videoPageReady: Page;
  /** Page on playlist video URL (video in middle of playlist) — for playlist navigation tests. */
  playlistVideoPageReady: Page;
  triggerEnterPictureInPicture: TriggerEnterPictureInPictureFn;
  assertPiPWindowHasPlayer: AssertPiPWindowHasPlayerFn;
  /** Wait until ad overlay is gone in PiP (so context menu etc. are available). */
  waitForPiPAdToEnd: WaitForPiPAdToEndFn;
}>({
  authState: [undefined, { option: true }],

  context: async ({ userscriptBody, browser, authState }, use) => {
    const addInitAndUse = async (ctx: Awaited<ReturnType<typeof browser.newContext>>) => {
      await ctx.addInitScript(initHandlerStub, userscriptBody);
      await use(ctx);
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

  /** Userscript body (without header). Requires build. */
  userscriptBody: async ({}, use) => {
    await use(getUserscriptBody());
  },

  /** Accept YouTube cookie/consent dialog (button on main page). Waits for next DOMContentLoaded after click (reload). */
  acceptYouTubeConsent: async ({}, use) => {
    const accept: AcceptYouTubeConsentFn = async (page) => {
      if (process.env.CI) {
        // Skip consent on CI (GitHub Actions runs in America, where YouTube cookie consent is not shown)
        return;
      }
      try {
        await Promise.all([
          page.waitForEvent('domcontentloaded', { timeout: E2E_WAIT_TIMEOUT_MS }),
          page.getByRole('button', { name: 'Accept the use of cookies and' }).click(),
        ]);
      } catch {
        // No consent or already accepted
      }
    };
    await use(accept);
  },

  /** Page on video URL with consent accepted, userscript injected, and enterpictureinpicture handler registered. */
  videoPageReady: async ({ page, acceptYouTubeConsent }, use) => {
    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded' });
    await acceptYouTubeConsent(page);
    await page.waitForFunction(() => window.__E2E_PIP__?.has('enterpictureinpicture'), {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });
    await use(page);
  },

  /** Page on playlist video URL (video in middle of playlist). Same as videoPageReady but for playlist flow. */
  playlistVideoPageReady: async ({ page, acceptYouTubeConsent }, use) => {
    await page.goto(PLAYLIST_VIDEO_URL, { waitUntil: 'domcontentloaded' });
    await acceptYouTubeConsent(page);
    await page.waitForFunction(() => window.__E2E_PIP__?.has('enterpictureinpicture'), {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });
    await use(page);
  },

  /** Triggers the enterpictureinpicture action on the given page (calls __E2E_PIP__.trigger). */
  triggerEnterPictureInPicture: async ({}, use) => {
    const trigger: TriggerEnterPictureInPictureFn = (page) =>
      page.evaluate(() => window.__E2E_PIP__!.trigger('enterpictureinpicture'));
    await use(trigger);
  },

  /** Asserts PiP window is open and contains ytd-app and movie player. */
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

  /** Wait until ad overlay is gone in PiP (all ads ended; YouTube may show 2+ in a row). */
  waitForPiPAdToEnd: async ({}, use) => {
    const isAdOverlayGone = (page: Page) =>
      page.evaluate((adOverlaySel: string) => {
        const pip = window.documentPictureInPicture?.window;
        const overlay = pip?.document.querySelector(adOverlaySel);
        if (!overlay) return true;
        const style = pip?.document.defaultView?.getComputedStyle(overlay);
        return style?.display === 'none' || overlay.getBoundingClientRect().height === 0;
      }, E2E_SELECTORS.AD_PLAYER_OVERLAY);

    /** Click Skip ad only when PiP is a separate page (real/trusted click via locator). */
    const tryClickSkipAdInPip = async (page: Page): Promise<boolean> => {
      const ctx = page.context();
      const pages = ctx.pages();
      for (const p of pages) {
        if (p === page) continue;
        const loc = p.locator(E2E_SELECTORS.SKIP_AD_BUTTON);
        const visible = await loc.isVisible().catch(() => false);
        if (visible) {
          await loc.click();
          return true;
        }
      }
      return false;
    };

    const waitFn: WaitForPiPAdToEndFn = async (page) => {
      const timeout = E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS;
      const maxAttempts = 10;
      for (let i = 0; i < maxAttempts; i++) {
        const skipPoll = setInterval(() => void tryClickSkipAdInPip(page), E2E_PIP_SKIP_AD_POLL_MS);
        try {
          await page.waitForFunction(
            (adOverlaySel: string) => {
              const pip = window.documentPictureInPicture?.window;
              const overlay = pip?.document.querySelector(adOverlaySel);
              if (!overlay) return true;
              const style = pip?.document.defaultView?.getComputedStyle(overlay);
              return style?.display === 'none' || overlay.getBoundingClientRect().height === 0;
            },
            E2E_SELECTORS.AD_PLAYER_OVERLAY,
            { timeout }
          );
        } finally {
          clearInterval(skipPoll);
        }
        await page.waitForTimeout(E2E_PIP_AD_STABILITY_MS);
        if (await isAdOverlayGone(page)) return;
      }
    };
    await use(waitFn);
  },
});

export { expect };
