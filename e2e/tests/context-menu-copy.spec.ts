/**
 * E2E: Context menu copy actions in PiP (copy video URL, URL at time, embed iframe, debug info).
 *
 * Ads may show first, so not all menu items are visible immediately — we wait for each
 * item to become visible with an extended timeout before clicking and asserting clipboard.
 */
import type { Page } from '@playwright/test';
import { clickContextMenuItem, expect, test, waitForContextMenuItemVisible } from '../fixtures';
import {
  COPY_MENU_POSITIONS_FROM_END,
  E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
  E2E_MIN_PLAYBACK_TIME_FOR_URL_AT_TIME_S,
  E2E_WAIT_TIMEOUT_MS,
} from '../constants';
import { E2E_SELECTORS } from '../selectors';

/** Player API methods used here (YouTube's #movie_player). */
interface E2EMoviePlayer extends HTMLElement {
  getCurrentTime?(): number;
  getPlayerState?(): number;
  playVideo?(): void;
}

/**
 * Wait until the video in PiP has played past `minTime` seconds; start it if it is not playing (after ads it can
 * stay paused or unstarted on CI). "Copy video URL at current time" omits t= near 0.
 */
async function waitForPlaybackTimeInPip(page: Page, minTime: number): Promise<void> {
  const args = { moviePlayer: E2E_SELECTORS.MOVIE_PLAYER, minTime };
  try {
    await page.waitForFunction(
      ({ moviePlayer, minTime }: typeof args) => {
        const doc = window.documentPictureInPicture?.window?.document;
        const player = doc?.querySelector<E2EMoviePlayer>(moviePlayer);
        if (!player?.getCurrentTime || !player.getPlayerState) return false;
        const PLAYING = 1;
        const BUFFERING = 3;
        const state = player.getPlayerState();
        if (state !== PLAYING && state !== BUFFERING) player.playVideo?.();
        return player.getCurrentTime() >= minTime;
      },
      args,
      { timeout: E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS, polling: 500 }
    );
  } catch (error) {
    const state = await page
      .evaluate(({ moviePlayer }: typeof args) => {
        const player =
          window.documentPictureInPicture?.window?.document.querySelector<E2EMoviePlayer>(
            moviePlayer
          );
        if (!player) return 'no player in PiP';
        return `state=${player.getPlayerState?.()} t=${player.getCurrentTime?.()}`;
      }, args)
      .catch((e: unknown) => `state unavailable: ${String(e)}`);
    const original = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(`Video in PiP did not reach ${minTime}s: ${state} [${original}]`);
  }
}

test.describe('Context menu copy in PiP', () => {
  test('copy video URL, URL at time, embed iframe, debug info work', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
    waitForPiPAdToEnd,
  }) => {
    // Page hydration + up to 75s of ads + four copy steps do not fit the default 90s.
    test.setTimeout(180_000);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);
    await waitForPiPAdToEnd(page);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_POSITIONS_FROM_END.VIDEO_URL,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickContextMenuItem(page, COPY_MENU_POSITIONS_FROM_END.VIDEO_URL);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/watch|youtu\.be/);

    await waitForPlaybackTimeInPip(page, E2E_MIN_PLAYBACK_TIME_FOR_URL_AT_TIME_S);
    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_POSITIONS_FROM_END.URL_AT_TIME,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickContextMenuItem(page, COPY_MENU_POSITIONS_FROM_END.URL_AT_TIME);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/watch|youtu\.be/);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/[?&]t=|\?t=/);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_POSITIONS_FROM_END.EMBED,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickContextMenuItem(page, COPY_MENU_POSITIONS_FROM_END.EMBED);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toContain('<iframe');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/embed\//);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_POSITIONS_FROM_END.DEBUG_INFO,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickContextMenuItem(page, COPY_MENU_POSITIONS_FROM_END.DEBUG_INFO);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            try {
              const t = await navigator.clipboard.readText();
              return t.length > 0 && JSON.parse(t) !== undefined ? t : null;
            } catch {
              return null;
            }
          }),
        { timeout: E2E_WAIT_TIMEOUT_MS }
      )
      .not.toBeNull();
  });
});
