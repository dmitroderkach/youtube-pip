/**
 * E2E: Context menu copy actions in PiP (copy video URL, URL at time, embed iframe, debug info).
 *
 * Ads may show first, so not all menu items are visible immediately — we wait for each
 * item to become visible with an extended timeout before clicking and asserting clipboard.
 */
import type { Page } from '@playwright/test';
import { E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS, E2E_WAIT_TIMEOUT_MS } from '../constants';
import { test, expect } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

const COPY_MENU_INDICES = { VIDEO_URL: 2, URL_AT_TIME: 3, EMBED: 4, DEBUG_INFO: 5 } as const;

function openContextMenuInPip(page: Page, playerSelector: string): Promise<void> {
  return page.evaluate((sel) => {
    const pip = window.documentPictureInPicture?.window;
    const player = pip?.document.querySelector(sel);
    player?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 0, clientY: 0 })
    );
  }, playerSelector);
}

async function waitForContextMenuItemVisible(
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
  await openContextMenuInPip(page, E2E_SELECTORS.MOVIE_PLAYER);
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
      console.log({
        display: style?.display,
        visibility: style?.visibility,
        index: idx,
        text: item.textContent,
      });
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

function clickContextMenuItem(page: Page, index: number): Promise<void> {
  return page.evaluate(
    ({ selector, idx }: { selector: string; idx: number }) => {
      const pip = window.documentPictureInPicture?.window;
      const items = pip?.document.querySelectorAll<HTMLElement>(selector);
      items?.[idx]?.click();
    },
    { selector: E2E_SELECTORS.PANEL_MENU_ITEMS, idx: index }
  );
}

test.describe('Context menu copy in PiP', () => {
  test.slow();

  test('copy video URL, URL at time, embed iframe, debug info work', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
    waitForPiPAdToEnd,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);
    await waitForPiPAdToEnd(page);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_INDICES.VIDEO_URL,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickContextMenuItem(page, COPY_MENU_INDICES.VIDEO_URL);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/watch|youtu\.be/);

    await page.waitForTimeout(2000); // wait for video current time to be updated
    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_INDICES.URL_AT_TIME,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickContextMenuItem(page, COPY_MENU_INDICES.URL_AT_TIME);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/watch|youtu\.be/);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/[?&]t=|\?t=/);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_INDICES.EMBED,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickContextMenuItem(page, COPY_MENU_INDICES.EMBED);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toContain('<iframe');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/embed\//);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_INDICES.DEBUG_INFO,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickContextMenuItem(page, COPY_MENU_INDICES.DEBUG_INFO);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            try {
              const t = await navigator.clipboard.readText();
              return t.length > 0 && JSON.parse(t) !== undefined ? t : null;
            } catch {
              return null;
            }
          }),
        { timeout: E2E_WAIT_TIMEOUT_MS }
      )
      .not.toBeNull();
  });
});
