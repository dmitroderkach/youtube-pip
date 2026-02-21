/**
 * E2E PiP context menu helpers: open menu, wait for item visible, click item (shared by context-menu-copy and pip-focus).
 */
import type { Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';

/** Open context menu in PiP by dispatching contextmenu on the player. */
export function openContextMenuInPip(page: Page, playerSelector?: string): Promise<void> {
  const sel = playerSelector ?? E2E_SELECTORS.MOVIE_PLAYER;
  return page.evaluate((s) => {
    const pip = window.documentPictureInPicture?.window;
    const player = pip?.document.querySelector(s);
    player?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 0, clientY: 0 })
    );
  }, sel);
}

/** Wait for context menu to be closed, open it, wait for it visible, then wait for the item at index to be visible. */
export async function waitForContextMenuItemVisible(
  page: Page,
  index: number,
  timeoutMs: number
): Promise<void> {
  await page.waitForFunction(
    (menuSel) => {
      const pip = window.documentPictureInPicture?.window;
      return !pip?.document.querySelector(menuSel);
    },
    E2E_SELECTORS.CONTEXT_MENU,
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
  await openContextMenuInPip(page);
  await page.waitForFunction(
    (menuSel) => {
      const pip = window.documentPictureInPicture?.window;
      const menu = pip?.document.querySelector(menuSel);
      if (!menu) return false;
      const style = pip?.document.defaultView?.getComputedStyle(menu);
      return style?.display !== 'none' && menu.getBoundingClientRect().height > 0;
    },
    E2E_SELECTORS.CONTEXT_MENU,
    { timeout: timeoutMs }
  );
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
