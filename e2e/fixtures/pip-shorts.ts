import type { Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';

type ShortsPlayerTarget = 'main' | 'pip';

/**
 * Wait until the Shorts player is visible in the main page or in PiP. On timeout, throw with a description of
 * what was missing (no PiP window / no ytd-shorts / no player / no video / zero height / readyState), so CI
 * flakes are diagnosable from the error alone.
 */
async function waitForShortsPlayerVisible(page: Page, target: ShortsPlayerTarget): Promise<void> {
  const args = {
    target,
    shortsSel: E2E_SELECTORS.YTD_SHORTS,
    playerSel: E2E_SELECTORS.SHORTS_PLAYER,
    videoSel: E2E_SELECTORS.PLAYER_VIDEO,
  };
  try {
    await page.waitForFunction(
      ({ target, shortsSel, playerSel, videoSel }: typeof args) => {
        const doc = target === 'pip' ? window.documentPictureInPicture?.window?.document : document;
        const shorts = doc?.querySelector(shortsSel);
        const player = shorts?.querySelector(playerSel);
        const video = player?.querySelector<HTMLVideoElement>(videoSel);
        if (!doc || !shorts || !player || !video) return false;
        const style = doc.defaultView?.getComputedStyle(player as HTMLElement);
        return style?.display !== 'none' && player.getBoundingClientRect().height > 0;
      },
      args,
      { timeout: E2E_WAIT_TIMEOUT_MS }
    );
  } catch (error) {
    const state = await page
      .evaluate(({ target, shortsSel, playerSel, videoSel }: typeof args) => {
        const doc = target === 'pip' ? window.documentPictureInPicture?.window?.document : document;
        if (!doc) return 'no PiP window';
        const shorts = doc.querySelector(shortsSel);
        if (!shorts) return `no ${shortsSel} (url=${location.pathname})`;
        const player = shorts.querySelector(playerSel);
        if (!player) return `no ${playerSel} in ${shortsSel}`;
        const style = doc.defaultView?.getComputedStyle(player as HTMLElement);
        const rect = player.getBoundingClientRect();
        const video = player.querySelector<HTMLVideoElement>(videoSel);
        const videoState = video
          ? `video readyState=${video.readyState} paused=${video.paused} t=${video.currentTime.toFixed(1)}`
          : 'no <video>';
        return `player display=${style?.display} ${Math.round(rect.width)}x${Math.round(rect.height)}, ${videoState}`;
      }, args)
      .catch((e: unknown) => `state unavailable: ${String(e)}`);
    const original = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(
      `Shorts player not visible in ${target} within ${E2E_WAIT_TIMEOUT_MS}ms: ${state} [${original}]`
    );
  }
}

export async function waitForShortsPlayerVisibleInMain(page: Page): Promise<void> {
  await waitForShortsPlayerVisible(page, 'main');
}

export async function waitForShortsPlayerVisibleInPip(page: Page): Promise<void> {
  await waitForShortsPlayerVisible(page, 'pip');
}

export async function scrollToNextShortInPip(page: Page): Promise<void> {
  const context = page.context();
  const pages = context.pages();
  const pipPage = pages.find((p) => p !== page);

  if (!pipPage) {
    throw new Error('PiP page not found for Shorts navigation');
  }

  await pipPage.keyboard.press('ArrowDown');
}
