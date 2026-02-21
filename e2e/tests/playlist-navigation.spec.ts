/**
 * E2E: Navigation when switching video from playlist inside the PiP popup.
 *
 * Flow: open playlist video → open PiP popup → in popup: expand playlist → click another video
 *       → assert the clicked item has attribute selected.
 */
import type { Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { test } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

async function waitForMiniPlayerVisibleInPip(page: Page): Promise<void> {
  await page.waitForFunction(
    (miniPlayerSel: string) => {
      const pip = window.documentPictureInPicture?.window;
      const miniPlayer = pip?.document.querySelector(miniPlayerSel);
      if (!miniPlayer) return false;
      const style = pip?.document.defaultView?.getComputedStyle(miniPlayer);
      return style?.display !== 'none' && miniPlayer.getBoundingClientRect().height > 0;
    },
    E2E_SELECTORS.MINIPLAYER,
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
}

function clickExpandInPip(page: Page): Promise<void> {
  return page.evaluate(
    ({ miniPlayerSel, btnSel }: { miniPlayerSel: string; btnSel: string }) => {
      const pip = window.documentPictureInPicture?.window;
      const miniPlayer = pip?.document.querySelector(miniPlayerSel);
      const btn = miniPlayer?.querySelector<HTMLElement>(btnSel);
      btn?.click();
    },
    { miniPlayerSel: E2E_SELECTORS.MINIPLAYER, btnSel: E2E_SELECTORS.MENU_BUTTON }
  );
}

async function waitForPlaylistPanelVisibleInPip(page: Page): Promise<void> {
  await page.waitForFunction(
    ({ miniPlayerSel, panelSel }: { miniPlayerSel: string; panelSel: string }) => {
      const pip = window.documentPictureInPicture?.window;
      const miniPlayer = pip?.document.querySelector(miniPlayerSel);
      const panel = miniPlayer?.querySelector(panelSel);
      if (!panel) return false;
      const style = pip?.document.defaultView?.getComputedStyle(panel);
      return style?.display !== 'none' && panel.getBoundingClientRect().height > 0;
    },
    {
      miniPlayerSel: E2E_SELECTORS.MINIPLAYER,
      panelSel: E2E_SELECTORS.PLAYLIST_PANEL,
    },
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
}

function clickPlaylistItemInPip(page: Page, index: number): Promise<void> {
  return page.evaluate(
    ({ miniPlayerSel, itemSel, idx }: { miniPlayerSel: string; itemSel: string; idx: number }) => {
      const pip = window.documentPictureInPicture?.window;
      const miniPlayer = pip?.document.querySelector(miniPlayerSel);
      const items = miniPlayer?.querySelectorAll<HTMLElement>(itemSel);
      items?.[idx]?.click();
    },
    {
      miniPlayerSel: E2E_SELECTORS.MINIPLAYER,
      itemSel: E2E_SELECTORS.PLAYLIST_VIDEO_ITEM,
      idx: index,
    }
  );
}

async function waitForPlaylistItemVisibleInPip(page: Page, index: number): Promise<void> {
  await page.waitForFunction(
    ({ miniPlayerSel, itemSel, idx }: { miniPlayerSel: string; itemSel: string; idx: number }) => {
      const pip = window.documentPictureInPicture?.window;
      const miniPlayer = pip?.document.querySelector(miniPlayerSel);
      const items = miniPlayer?.querySelectorAll(itemSel);
      const item = items?.[idx];
      if (!item) return false;
      const style = pip?.document.defaultView?.getComputedStyle(item);
      return item.getBoundingClientRect().height > 0 && style?.display !== 'none';
    },
    {
      miniPlayerSel: E2E_SELECTORS.MINIPLAYER,
      itemSel: E2E_SELECTORS.PLAYLIST_VIDEO_ITEM,
      idx: index,
    },
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
}

async function waitForPlaylistItemSelectedInPip(page: Page, index: number): Promise<void> {
  await page.waitForFunction(
    ({
      miniPlayerSel,
      itemSel,
      rowSel,
      idx,
    }: {
      miniPlayerSel: string;
      itemSel: string;
      rowSel: string;
      idx: number;
    }) => {
      const pip = window.documentPictureInPicture?.window;
      const miniPlayer = pip?.document.querySelector(miniPlayerSel);
      const items = miniPlayer?.querySelectorAll(itemSel);
      const item = items?.[idx];
      if (!item) return false;
      const row = item.closest?.(rowSel) ?? item;
      return row.hasAttribute('selected');
    },
    {
      miniPlayerSel: E2E_SELECTORS.MINIPLAYER,
      itemSel: E2E_SELECTORS.PLAYLIST_VIDEO_ITEM,
      rowSel: E2E_SELECTORS.PLAYLIST_VIDEO_ROW,
      idx: index,
    },
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
}

test.describe('Playlist navigation in PiP popup', () => {
  test.slow();

  test.only('playlist video → open PiP → expand → click another video → clicked item has selected', async ({
    playlistVideoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
  }) => {
    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);

    await waitForMiniPlayerVisibleInPip(page);
    await clickExpandInPip(page);
    await waitForPlaylistPanelVisibleInPip(page);
    await waitForPlaylistItemVisibleInPip(page, 1);

    await clickPlaylistItemInPip(page, 1);

    await waitForPlaylistItemSelectedInPip(page, 1);
  });
});
