/**
 * E2E PiP like/dislike helpers: wait for buttons, aria-pressed, click (used by like-dislike.spec).
 */
import type { Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';

export type LikeDislikeAction = 'LIKE' | 'REMOVE_LIKE' | 'DISLIKE' | 'REMOVE_DISLIKE';

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

export async function waitForLikeButtonsVisibleInPip(page: Page): Promise<void> {
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

export async function waitForLikeDislikeAriaPressedInPip(
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

export async function clickLikeDislikeInPip(page: Page, action: LikeDislikeAction): Promise<void> {
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
