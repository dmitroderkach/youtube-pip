/**
 * Playwright fixtures: PiP stub + handler stub injected via addInitScript.
 * Stub implementation lives here; no Playwright scripts in scripts/.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from './constants';
import { E2E_SELECTORS } from './selectors';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(process.cwd());
const scriptPath = join(projectRoot, 'dist/userscript.js');

/** Handler stub: collects mediaSession.setActionHandler, exposes __E2E_PIP__.trigger/has. Runs in browser. */
function initHandlerStub(): void {
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
}

function getUserscriptBody(): string {
  if (!existsSync(scriptPath)) {
    throw new Error('Run "npm run build" first. dist/userscript.js not found.');
  }
  const raw = readFileSync(scriptPath, 'utf8');
  return raw.replace(/^[\s\S]*?\/\/ ==\/UserScript==\s*\n?/m, '');
}

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

type AcceptYouTubeConsentFn = (page: Page) => Promise<void>;

type TriggerEnterPictureInPictureFn = (page: Page) => Promise<void>;

type AssertPiPWindowHasPlayerFn = (page: Page) => Promise<void>;

export const test = base.extend<{
  userscriptBody: string;
  acceptYouTubeConsent: AcceptYouTubeConsentFn;
  videoPageReady: Page;
  triggerEnterPictureInPicture: TriggerEnterPictureInPictureFn;
  assertPiPWindowHasPlayer: AssertPiPWindowHasPlayerFn;
}>({
  context: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(initHandlerStub);
    await use(ctx);
    await ctx.close();
  },

  /** Userscript body (without header). Requires build. */
  userscriptBody: async ({ page: _page }, use) => {
    await use(getUserscriptBody());
  },

  /** Accept YouTube cookie/consent dialog (button on main page). Waits for next DOMContentLoaded after click (reload). */
  acceptYouTubeConsent: async ({ page: _page }, use) => {
    const accept: AcceptYouTubeConsentFn = async (page) => {
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
  videoPageReady: async ({ page, userscriptBody, acceptYouTubeConsent }, use) => {
    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded' });
    await acceptYouTubeConsent(page);
    await page.evaluate((code: string) => eval(code), userscriptBody);
    await page.waitForFunction(() => window.__E2E_PIP__?.has('enterpictureinpicture'), {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });
    await use(page);
  },

  /** Triggers the enterpictureinpicture action on the given page (calls __E2E_PIP__.trigger). */
  triggerEnterPictureInPicture: async ({ page: _page }, use) => {
    const trigger: TriggerEnterPictureInPictureFn = (page) =>
      page.evaluate(() => window.__E2E_PIP__!.trigger('enterpictureinpicture'));
    await use(trigger);
  },

  /** Asserts PiP window is open and contains ytd-app and movie player. */
  assertPiPWindowHasPlayer: async ({ page: _page }, use) => {
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
});

export { expect };
