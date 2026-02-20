/**
 * E2E: Focus management in PiP — #movie_player has focus when popup opens,
 * focus returns after click outside, is not on context menu while open, returns after ESC.
 */
import type { Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { test, expect } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

function isPlayerFocusedInPip(page: Page): Promise<boolean> {
  return page.evaluate((playerSel: string) => {
    const pip = window.documentPictureInPicture?.window;
    const doc = pip?.document;
    const player = doc?.querySelector(playerSel);
    const active = doc?.activeElement;
    return !!player && active != null && (active === player || player.contains(active));
  }, E2E_SELECTORS.MOVIE_PLAYER);
}

function isContextMenuFocusedInPip(page: Page): Promise<boolean> {
  return page.evaluate((menuSel: string) => {
    const pip = window.documentPictureInPicture?.window;
    const doc = pip?.document;
    const menu = doc?.querySelector(menuSel);
    const active = doc?.activeElement;
    return !!menu && active != null && (active === menu || menu.contains(active));
  }, E2E_SELECTORS.CONTEXT_MENU);
}

function isContextMenuVisibleInPip(page: Page): Promise<boolean> {
  return page.evaluate((menuSel: string) => {
    const pip = window.documentPictureInPicture?.window;
    const menu = pip?.document.querySelector(menuSel);
    if (!menu) return false;
    const style = pip?.document.defaultView?.getComputedStyle(menu);
    return style?.display !== 'none' && menu.getBoundingClientRect().height > 0;
  }, E2E_SELECTORS.CONTEXT_MENU);
}

function clickOutsidePlayerInPip(page: Page): Promise<void> {
  return page.evaluate((playerSel: string) => {
    const pip = window.documentPictureInPicture?.window;
    const doc = pip?.document;
    if (!doc) return;
    const player = doc.querySelector(playerSel) as HTMLElement | null;
    if (player) {
      const rect = player.getBoundingClientRect();
      const x = Math.max(0, rect.left - 10);
      const y = rect.bottom + 10;
      const el = doc.elementFromPoint(x, y);
      (el ?? doc.body).dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })
      );
    } else {
      doc.body.click();
    }
  }, E2E_SELECTORS.MOVIE_PLAYER);
}

function openContextMenuInPip(page: Page): Promise<void> {
  return page.evaluate((playerSel: string) => {
    const pip = window.documentPictureInPicture?.window;
    const player = pip?.document.querySelector(playerSel);
    player?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 0, clientY: 0 })
    );
  }, E2E_SELECTORS.MOVIE_PLAYER);
}

function pressEscapeInPip(page: Page): Promise<void> {
  return page.evaluate((menuSel: string) => {
    const pip = window.documentPictureInPicture?.window;
    pip?.document
      .querySelector(menuSel)
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }, E2E_SELECTORS.CONTEXT_MENU);
}

test.describe('PiP focus', () => {
  test('player has focus when PiP opens; returns after click outside; not on menu while open; returns after ESC', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
  }) => {
    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);

    await clickOutsidePlayerInPip(page);
    await expect
      .poll(() => isPlayerFocusedInPip(page), { timeout: E2E_WAIT_TIMEOUT_MS })
      .toBe(true);

    await openContextMenuInPip(page);
    await page.waitForFunction(
      (menuSel: string) => {
        const pip = window.documentPictureInPicture?.window;
        const menu = pip?.document.querySelector(menuSel);
        return menu && pip?.document.defaultView?.getComputedStyle(menu).display !== 'none';
      },
      E2E_SELECTORS.CONTEXT_MENU,
      { timeout: E2E_WAIT_TIMEOUT_MS }
    );
    await expect.poll(() => isContextMenuFocusedInPip(page)).toBe(false);

    await pressEscapeInPip(page);
    await expect
      .poll(() => isContextMenuVisibleInPip(page), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toBe(false);
    await expect
      .poll(() => isPlayerFocusedInPip(page), { timeout: E2E_WAIT_TIMEOUT_MS })
      .toBe(true);
  });
});
