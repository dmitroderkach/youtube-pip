import type { Page } from '@playwright/test';
import { E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';

/** Player API methods used here (YouTube's #movie_player / #shorts-player). */
interface E2EPlayerApi extends HTMLElement {
  getCurrentTime?(): number;
  getPlayerState?(): number;
  playVideo?(): void;
}

export type PlaybackWaitResult = { reached: true } | { reached: false; state: string };

/**
 * Wait until the video in PiP has played past `minTime` seconds; start it if it is not playing (after ads it can
 * stay paused or unstarted on CI). "Copy video URL at current time" omits t= near 0, so a fixed delay was flaky.
 * @returns reached: false (with the player state) when the video did not play, e.g. on CI runners where YouTube
 *   serves the ads but never loads the video stream (stuck at 0:00 with a spinner)
 */
export async function waitForPlaybackTimeInPip(
  page: Page,
  minTime: number,
  playerSelector: string = E2E_SELECTORS.MOVIE_PLAYER
): Promise<PlaybackWaitResult> {
  const args = { playerSelector, minTime };
  try {
    await page.waitForFunction(
      ({ playerSelector, minTime }: typeof args) => {
        const doc = window.documentPictureInPicture?.window?.document;
        const player = doc?.querySelector<E2EPlayerApi>(playerSelector);
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
    return { reached: true };
  } catch (error) {
    const state = await page
      .evaluate(({ playerSelector }: typeof args) => {
        const player =
          window.documentPictureInPicture?.window?.document.querySelector<E2EPlayerApi>(
            playerSelector
          );
        if (!player) return 'no player in PiP';
        return `state=${player.getPlayerState?.()} t=${player.getCurrentTime?.()}`;
      }, args)
      .catch((e: unknown) => `state unavailable: ${String(e)}`);
    const original = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { reached: false, state: `${state} [${original}]` };
  }
}
