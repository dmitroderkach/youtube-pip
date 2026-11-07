/**
 * E2E PiP context menu helpers: open menu, wait for item visible, click item (shared by context-menu-copy and pip-focus).
 */
import type { Page } from '@playwright/test';
import { E2E_CONTEXT_MENU_REOPEN_INTERVAL_MS, E2E_WAIT_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';

/**
 * Open context menu in PiP by dispatching contextmenu on the player.
 * Must be cancelable like a real right-click: the player opens the menu and calls preventDefault(); with
 * web_watch_pip / web_shorts_pip its "contextmenu outside the menu" close listener is on the PiP document,
 * and a non-cancelable event reaches it un-prevented, so the menu would close right after opening.
 */
export function openContextMenuInPip(page: Page, playerSelector?: string): Promise<void> {
  const sel = playerSelector ?? E2E_SELECTORS.MOVIE_PLAYER;
  return page.evaluate((s) => {
    const pip = window.documentPictureInPicture?.window;
    const player = pip?.document.querySelector(s);
    player?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 2,
        clientX: 0,
        clientY: 0,
      })
    );
  }, sel);
}

/** Wait for context menu to be closed, open it (on given player), wait for it visible, then wait for the item at index to be visible. */
export async function waitForContextMenuItemVisible(
  page: Page,
  index: number,
  timeoutMs: number,
  playerSelector?: string
): Promise<void> {
  // Wait until no menu is visible in PiP. With web_watch_pip / web_shorts_pip the closed menu stays
  // in the PiP document (hidden), so "absent" alone would never become true there.
  await page.waitForFunction(
    (menuSel) => {
      const pip = window.documentPictureInPicture?.window;
      const menu = pip?.document.querySelector<HTMLElement>(menuSel);
      return !menu || pip?.getComputedStyle(menu).display === 'none';
    },
    E2E_SELECTORS.CONTEXT_MENU,
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
  const deadline = Date.now() + timeoutMs;
  await openContextMenuInPip(page, playerSelector);
  while (
    !(await page
      .waitForFunction(
        (menuSel) => {
          const pip = window.documentPictureInPicture?.window;
          const menu = pip?.document.querySelector(menuSel);
          if (!menu) return false;
          const style = pip?.document.defaultView?.getComputedStyle(menu);
          return style?.display !== 'none' && menu.getBoundingClientRect().height > 0;
        },
        E2E_SELECTORS.CONTEXT_MENU,
        { timeout: E2E_CONTEXT_MENU_REOPEN_INTERVAL_MS }
      )
      .then(() => true)
      .catch(() => false))
  ) {
    if (Date.now() > deadline) {
      throw new Error(`Context menu did not open in PiP within ${timeoutMs}ms`);
    }
    await openContextMenuInPip(page, playerSelector);
  }
  const itemsSelector = E2E_SELECTORS.PANEL_MENU_ITEMS;
  await page.waitForFunction(
    ({ selector, idx }: { selector: string; idx: number }) => {
      const pip = window.documentPictureInPicture?.window;
      const doc = pip?.document;
      if (!doc) return false;
      const items = doc.querySelectorAll(selector);
      const item = items[idx];
      if (!item) return false;
      const style = doc.defaultView?.getComputedStyle(item);
      return (
        item.getBoundingClientRect().height > 0 &&
        style?.display !== 'none' &&
        style?.visibility !== 'hidden'
      );
    },
    { selector: itemsSelector, idx: index },
    { timeout: timeoutMs }
  );
}

export function clickContextMenuItem(page: Page, index: number): Promise<void> {
  return page.evaluate(
    ({ selector, idx }: { selector: string; idx: number }) => {
      const pip = window.documentPictureInPicture?.window;
      const items = pip?.document.querySelectorAll<HTMLElement>(selector);
      items?.[idx]?.click();
    },
    { selector: E2E_SELECTORS.PANEL_MENU_ITEMS, idx: index }
  );
}
