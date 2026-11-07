/**
 * E2E PiP context menu helpers: open menu, wait for item visible, click item (shared by context-menu-copy and pip-focus).
 */
import type { Page } from '@playwright/test';
import { E2E_CONTEXT_MENU_REOPEN_INTERVAL_MS, E2E_WAIT_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';

/** Items of one context menu (relative to the menu element). */
const MENU_ITEMS_IN_MENU = '.ytp-panel-menu > .ytp-menuitem';

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

/**
 * Wait for context menu to be closed, open it (on given player), wait for it visible, then wait for the item at
 * `positionFromEnd` (0 = last item, see COPY_MENU_POSITIONS_FROM_END) to be visible.
 */
export async function waitForContextMenuItemVisible(
  page: Page,
  positionFromEnd: number,
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
  await page.waitForFunction(
    ({ menuSel, itemsSel, pos }: { menuSel: string; itemsSel: string; pos: number }) => {
      const pip = window.documentPictureInPicture?.window;
      const doc = pip?.document;
      if (!doc) return false;
      const menu = Array.from(doc.querySelectorAll<HTMLElement>(menuSel)).find(
        (m) => m.style.display !== 'none'
      );
      const items = menu ? Array.from(menu.querySelectorAll(itemsSel)) : [];
      const item = items[items.length - 1 - pos];
      if (!item) return false;
      const style = doc.defaultView?.getComputedStyle(item);
      return (
        item.getBoundingClientRect().height > 0 &&
        style?.display !== 'none' &&
        style?.visibility !== 'hidden'
      );
    },
    { menuSel: E2E_SELECTORS.CONTEXT_MENU, itemsSel: MENU_ITEMS_IN_MENU, pos: positionFromEnd },
    { timeout: timeoutMs }
  );
}

/** Click the item at `positionFromEnd` (0 = last item) in the visible context menu in PiP. */
export function clickContextMenuItem(page: Page, positionFromEnd: number): Promise<void> {
  return page.evaluate(
    ({ menuSel, itemsSel, pos }: { menuSel: string; itemsSel: string; pos: number }) => {
      const doc = window.documentPictureInPicture?.window?.document;
      const menu = Array.from(doc?.querySelectorAll<HTMLElement>(menuSel) ?? []).find(
        (m) => m.style.display !== 'none'
      );
      const items = menu ? Array.from(menu.querySelectorAll<HTMLElement>(itemsSel)) : [];
      items[items.length - 1 - pos]?.click();
    },
    { menuSel: E2E_SELECTORS.CONTEXT_MENU, itemsSel: MENU_ITEMS_IN_MENU, pos: positionFromEnd }
  );
}

type PipWindowWithBezelFlag = Window & { __e2eCopiedBezelShown?: boolean };

/**
 * Start recording whether YouTube's "copied" bezel shows in the PiP player (it is visible for ~500 ms, so a
 * MutationObserver records it). Call before the action that copies; then waitForCopyFeedbackInPip.
 */
export async function watchCopiedBezelInPip(page: Page): Promise<void> {
  await page.evaluate((bezelSel: string) => {
    const win = window.documentPictureInPicture?.window as PipWindowWithBezelFlag | undefined;
    const doc = win?.document;
    if (!win || !doc) return;
    win.__e2eCopiedBezelShown = false;
    const bezelShown = () =>
      Array.from(doc.querySelectorAll<HTMLElement>(bezelSel)).some(
        (b) => !!b.parentElement && win.getComputedStyle(b.parentElement).display !== 'none'
      );
    const observer = new MutationObserver(() => {
      if (bezelShown()) {
        win.__e2eCopiedBezelShown = true;
        observer.disconnect();
      }
    });
    observer.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }, E2E_SELECTORS.PLAYER_BEZEL);
}

/** Expect the same feedback as on the page after a copy: the "copied" bezel showed and the menu closed. */
export async function waitForCopyFeedbackInPip(page: Page): Promise<void> {
  await page.waitForFunction(
    (menuSel: string) => {
      const win = window.documentPictureInPicture?.window as PipWindowWithBezelFlag | undefined;
      const menuOpen = Array.from(win?.document.querySelectorAll<HTMLElement>(menuSel) ?? []).some(
        (m) => win!.getComputedStyle(m).display !== 'none'
      );
      return !!win?.__e2eCopiedBezelShown && !menuOpen;
    },
    E2E_SELECTORS.CONTEXT_MENU,
    { timeout: E2E_WAIT_TIMEOUT_MS }
  );
}

/** Click a copy item (position from the end) in the visible context menu in PiP and expect copy feedback. */
export async function clickCopyMenuItemInPip(page: Page, positionFromEnd: number): Promise<void> {
  await watchCopiedBezelInPip(page);
  await clickContextMenuItem(page, positionFromEnd);
  await waitForCopyFeedbackInPip(page);
}

/** Focus must stay on the item this long: YouTube moves focus to the first item shortly after opening the menu. */
const FOCUS_STABLE_MS = 300;
const FOCUS_ATTEMPTS = 5;

/**
 * Focus the item at `positionFromEnd` in the visible context menu in PiP (keyboard navigation starts there).
 * Re-focuses until focus stays put: right after opening, YouTube focuses the first item itself, and an ArrowDown
 * pressed then started from the top ("Expected: 4, Received: 7").
 */
export async function focusContextMenuItemInPip(
  page: Page,
  positionFromEnd: number
): Promise<boolean> {
  for (let attempt = 0; attempt < FOCUS_ATTEMPTS; attempt++) {
    const focused = await page.evaluate(
      ({ menuSel, itemsSel, pos }: { menuSel: string; itemsSel: string; pos: number }) => {
        const doc = window.documentPictureInPicture?.window?.document;
        const menu = Array.from(doc?.querySelectorAll<HTMLElement>(menuSel) ?? []).find(
          (m) => m.style.display !== 'none'
        );
        const items = menu ? Array.from(menu.querySelectorAll<HTMLElement>(itemsSel)) : [];
        const item = items[items.length - 1 - pos];
        item?.focus();
        return !!item && doc?.activeElement === item;
      },
      { menuSel: E2E_SELECTORS.CONTEXT_MENU, itemsSel: MENU_ITEMS_IN_MENU, pos: positionFromEnd }
    );
    if (!focused) continue;
    await page.waitForTimeout(FOCUS_STABLE_MS);
    if ((await focusedContextMenuItemPositionInPip(page)) === positionFromEnd) return true;
  }
  return false;
}

/** Position from the end of the focused item in the visible context menu in PiP, or -1. */
export function focusedContextMenuItemPositionInPip(page: Page): Promise<number> {
  return page.evaluate(
    ({ menuSel, itemsSel }: { menuSel: string; itemsSel: string }) => {
      const doc = window.documentPictureInPicture?.window?.document;
      const menu = Array.from(doc?.querySelectorAll<HTMLElement>(menuSel) ?? []).find(
        (m) => m.style.display !== 'none'
      );
      const items = menu ? Array.from(menu.querySelectorAll<HTMLElement>(itemsSel)) : [];
      const index = items.indexOf(doc?.activeElement as HTMLElement);
      return index === -1 ? -1 : items.length - 1 - index;
    },
    { menuSel: E2E_SELECTORS.CONTEXT_MENU, itemsSel: MENU_ITEMS_IN_MENU }
  );
}
