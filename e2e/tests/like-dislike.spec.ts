/**
 * E2E: Like / remove like / dislike / remove dislike inside the PiP popup.
 * Opens PiP first, then runs like/dislike flow in popup context; asserts via network.
 */
import type { Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { test } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

const LIKE_LIKE_URL = 'https://www.youtube.com/youtubei/v1/like/like?prettyPrint=false';
const LIKE_REMOVELIKE_URL = 'https://www.youtube.com/youtubei/v1/like/removelike?prettyPrint=false';
const LIKE_DISLIKE_URL = 'https://www.youtube.com/youtubei/v1/like/dislike?prettyPrint=false';

type LikeDislikeAction = 'LIKE' | 'REMOVE_LIKE' | 'DISLIKE' | 'REMOVE_DISLIKE';

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

async function waitForLikeButtonsVisibleInPip(page: Page): Promise<void> {
  await page.waitForFunction(
    ({ likeSel, btnSel }: { likeSel: string; btnSel: string }) => {
      const pip = window.documentPictureInPicture?.window;
      const doc = pip?.document;
      if (!doc) return false;
      const toggles = doc.querySelectorAll(likeSel);
      if (toggles.length < 2) return false;
      const firstBtn = toggles[0]?.querySelector(btnSel);
      const secondBtn = toggles[1]?.querySelector(btnSel);
      if (!firstBtn || !secondBtn) return false;
      const style0 = pip.getComputedStyle(firstBtn as Element);
      const style1 = pip.getComputedStyle(secondBtn as Element);
      return (
        style0.display !== 'none' &&
        style1.display !== 'none' &&
        (firstBtn as HTMLElement).getBoundingClientRect().height > 0 &&
        (secondBtn as HTMLElement).getBoundingClientRect().height > 0
      );
    },
    { likeSel: E2E_SELECTORS.LIKE_BUTTON, btnSel: E2E_SELECTORS.BUTTON_SHAPE },
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
}

const ACTION_TOGGLE_INDEX: Record<LikeDislikeAction, number> = {
  LIKE: 0,
  REMOVE_LIKE: 0,
  DISLIKE: 1,
  REMOVE_DISLIKE: 1,
};

const ACTION_EXPECT_PRESSED: Record<LikeDislikeAction, boolean> = {
  LIKE: false,
  REMOVE_LIKE: true,
  DISLIKE: false,
  REMOVE_DISLIKE: true,
};

async function waitForLikeDislikeAriaPressedInPip(
  page: Page,
  action: LikeDislikeAction,
  options?: { afterClick?: boolean }
): Promise<void> {
  const toggleIndex = ACTION_TOGGLE_INDEX[action];
  const expectedBefore = ACTION_EXPECT_PRESSED[action];
  const expectedPressed = options?.afterClick ? !expectedBefore : expectedBefore;
  await page.waitForFunction(
    ({
      likeSel,
      btnSel,
      idx,
      pressed,
    }: {
      likeSel: string;
      btnSel: string;
      idx: number;
      pressed: boolean;
    }) => {
      const pip = window.documentPictureInPicture?.window;
      const toggles = pip?.document?.querySelectorAll(likeSel);
      const btn = toggles?.[idx]?.querySelector(btnSel);
      if (!btn) return false;
      const current = btn.getAttribute('aria-pressed') === 'true';
      return current === pressed;
    },
    {
      likeSel: E2E_SELECTORS.LIKE_BUTTON,
      btnSel: E2E_SELECTORS.BUTTON_SHAPE,
      idx: toggleIndex,
      pressed: expectedPressed,
    },
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
}

async function clickLikeDislikeInPip(page: Page, action: LikeDislikeAction): Promise<void> {
  await waitForLikeDislikeAriaPressedInPip(page, action);
  const toggleIndex = ACTION_TOGGLE_INDEX[action];
  await page.evaluate(
    ({ likeSel, btnSel, idx }: { likeSel: string; btnSel: string; idx: number }) => {
      const pip = window.documentPictureInPicture?.window;
      const toggles = pip?.document?.querySelectorAll(likeSel);
      const btn = toggles?.[idx]?.querySelector<HTMLElement>(btnSel);
      btn?.click();
    },
    {
      likeSel: E2E_SELECTORS.LIKE_BUTTON,
      btnSel: E2E_SELECTORS.BUTTON_SHAPE,
      idx: toggleIndex,
    }
  );
  await waitForLikeDislikeAriaPressedInPip(page, action, { afterClick: true });
}

test.describe('Like / dislike in PiP popup (auth, network)', () => {
  test.use({ authState: true });

  test('open PiP → like → remove like → dislike → remove dislike triggers correct API requests', async ({
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
    await waitForLikeButtonsVisibleInPip(page);

    // 1) Like
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url() === LIKE_LIKE_URL,
        {
          timeout: E2E_WAIT_TIMEOUT_MS,
        }
      ),
      clickLikeDislikeInPip(page, 'LIKE'),
    ]);

    // 2) Remove like
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url() === LIKE_REMOVELIKE_URL,
        {
          timeout: E2E_WAIT_TIMEOUT_MS,
        }
      ),
      clickLikeDislikeInPip(page, 'REMOVE_LIKE'),
    ]);

    // 3) Dislike
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url() === LIKE_DISLIKE_URL,
        {
          timeout: E2E_WAIT_TIMEOUT_MS,
        }
      ),
      clickLikeDislikeInPip(page, 'DISLIKE'),
    ]);

    // 4) Remove dislike (same removelike endpoint)
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url() === LIKE_REMOVELIKE_URL,
        {
          timeout: E2E_WAIT_TIMEOUT_MS,
        }
      ),
      clickLikeDislikeInPip(page, 'REMOVE_DISLIKE'),
    ]);
  });
});
