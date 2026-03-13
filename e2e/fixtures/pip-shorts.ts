import type { Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';

export async function waitForShortsPlayerVisibleInMain(page: Page): Promise<void> {
  await page.waitForFunction(
    ({
      shortsSel,
      playerSel,
      videoSel,
    }: {
      shortsSel: string;
      playerSel: string;
      videoSel: string;
    }) => {
      const shorts = document.querySelector(shortsSel);
      const player = shorts?.querySelector(playerSel);
      const video = player?.querySelector<HTMLVideoElement>(videoSel);
      if (!shorts || !player || !video) return false;
      const style = getComputedStyle(player as HTMLElement);
      return style.display !== 'none' && player.getBoundingClientRect().height > 0;
    },
    {
      shortsSel: E2E_SELECTORS.YTD_SHORTS,
      playerSel: E2E_SELECTORS.SHORTS_PLAYER,
      videoSel: E2E_SELECTORS.PLAYER_VIDEO,
    },
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
}

export async function waitForShortsPlayerVisibleInPip(page: Page): Promise<void> {
  await page.waitForFunction(
    ({
      shortsSel,
      playerSel,
      videoSel,
    }: {
      shortsSel: string;
      playerSel: string;
      videoSel: string;
    }) => {
      const pip = window.documentPictureInPicture?.window;
      const doc = pip?.document;
      const shorts = doc?.querySelector(shortsSel);
      const player = shorts?.querySelector(playerSel);
      const video = player?.querySelector<HTMLVideoElement>(videoSel);
      if (!shorts || !player || !video) return false;
      const style = doc?.defaultView?.getComputedStyle(player as HTMLElement);
      return style?.display !== 'none' && player.getBoundingClientRect().height > 0;
    },
    {
      shortsSel: E2E_SELECTORS.YTD_SHORTS,
      playerSel: E2E_SELECTORS.SHORTS_PLAYER,
      videoSel: E2E_SELECTORS.PLAYER_VIDEO,
    },
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
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
