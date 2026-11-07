/**
 * E2E: the player context menu keeps working on the page after it was used in PiP.
 *
 * With web_watch_pip / web_shorts_pip YouTube opens the menu directly in the PiP document. If it is not brought
 * back when PiP closes, YouTube keeps reusing the stranded element and items no longer close the menu
 * (covered by the chromium-yt-pip / chromium-all-flags projects).
 */
import type { Page } from '@playwright/test';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { openContextMenuInPip, test, expect } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

/** "Stats for nerds" is always the last item of the player context menu. */
const LAST_ITEM_FROM_END = 0;

function visibleMenuOnPage(page: Page): Promise<boolean> {
  return page.evaluate((menuSel) => {
    return Array.from(document.querySelectorAll<HTMLElement>(menuSel)).some(
      (m) => getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().height > 0
    );
  }, E2E_SELECTORS.CONTEXT_MENU);
}

test.describe('Context menu on the page after using it in PiP', () => {
  test('menu opened in PiP, PiP closed → menu on the page opens and closes on item click', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
  }) => {
    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);
    await openContextMenuInPip(page);
    await page.waitForFunction(
      (menuSel) => {
        const doc = window.documentPictureInPicture?.window?.document;
        return Array.from(doc?.querySelectorAll<HTMLElement>(menuSel) ?? []).some(
          (m) => m.style.display !== 'none'
        );
      },
      E2E_SELECTORS.CONTEXT_MENU,
      { timeout: E2E_WAIT_TIMEOUT_MS }
    );

    // Close PiP while the menu is still open
    await page.evaluate(() => window.documentPictureInPicture?.window?.close());
    await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });
    await page.locator(E2E_SELECTORS.MOVIE_PLAYER).waitFor({ state: 'visible' });

    // Open the menu on the page with a real right-click
    const box = await page.locator(E2E_SELECTORS.MOVIE_PLAYER).boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 3, { button: 'right' });
    await expect.poll(() => visibleMenuOnPage(page), { timeout: E2E_WAIT_TIMEOUT_MS }).toBe(true);

    // Click the last item; the menu must close
    const itemCenter = await page.evaluate(
      ({ menuSel, pos }) => {
        const menu = Array.from(document.querySelectorAll<HTMLElement>(menuSel)).find(
          (m) => getComputedStyle(m).display !== 'none'
        );
        const items = menu
          ? Array.from(menu.querySelectorAll<HTMLElement>('.ytp-panel-menu > .ytp-menuitem'))
          : [];
        const r = items[items.length - 1 - pos]?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      },
      { menuSel: E2E_SELECTORS.CONTEXT_MENU, pos: LAST_ITEM_FROM_END }
    );
    expect(itemCenter).not.toBeNull();
    await page.mouse.click(itemCenter!.x, itemCenter!.y);
    await expect.poll(() => visibleMenuOnPage(page), { timeout: E2E_WAIT_TIMEOUT_MS }).toBe(false);
  });
});
