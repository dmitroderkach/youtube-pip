/**
 * E2E: our own ways to open PiP from the page (src/ui/PiPEntryPoints.ts):
 * - the "Відкрити картинку в картинці" item at the top of the player context menu (watch page and mini player),
 *   absent from the menu in the PiP window;
 * - the PiP button in the player controls, hidden in the PiP window.
 * Both are opened with real mouse clicks (a real user activation, as for the owner).
 */
import type { Page } from '@playwright/test';
import { E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS, E2E_WAIT_TIMEOUT_MS } from '../constants';
import { expect, test, waitForContextMenuItemVisible } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

const MENU_ITEM = '.ytpip-open-menuitem';
const MENU_ITEM_LABEL = 'Відкрити картинку в картинці';
const CONTROLS_BUTTON = '.ytpip-open-button';
/** Right-click point inside the player, as a share of its size (away from the controls and the center button). */
const RIGHT_CLICK_AT = { X: 0.5, Y: 0.3 } as const;
/** Rounding slack when comparing element rectangles (px). */
const RECT_SLACK_PX = 1;

/** Shown context menu on the page: whether our item is in it, and whether every item fits inside the menu. */
function shownMenuOnPage(page: Page) {
  return page.evaluate(
    ({ menuSel, itemSel, slack }) => {
      const menu = Array.from(document.querySelectorAll<HTMLElement>(menuSel)).find(
        (m) => getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().height > 0
      );
      if (!menu) return null;
      const box = menu.getBoundingClientRect();
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>('.ytp-panel-menu > .ytp-menuitem')
      );
      return {
        hasItem: menu.querySelector(itemSel) !== null,
        firstIsItem: items[0]?.matches(itemSel) ?? false,
        allItemsFit: items.every((i) => i.getBoundingClientRect().bottom <= box.bottom + slack),
      };
    },
    { menuSel: E2E_SELECTORS.CONTEXT_MENU, itemSel: MENU_ITEM, slack: RECT_SLACK_PX }
  );
}

async function rightClickPlayer(page: Page, playerSelector: string): Promise<void> {
  const box = await page.locator(playerSelector).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    box!.x + box!.width * RIGHT_CLICK_AT.X,
    box!.y + box!.height * RIGHT_CLICK_AT.Y,
    {
      button: 'right',
    }
  );
}

async function closePiPAndWait(page: Page): Promise<void> {
  await page.evaluate(() => window.documentPictureInPicture?.window?.close());
  await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
    timeout: E2E_WAIT_TIMEOUT_MS,
  });
}

/** "Stats for nerds" is always the last item of the player context menu. */
const LAST_ITEM_FROM_END = 0;

/** Open the context menu in PiP (reopening until it shows, as the copy tests do) and report whether our item is in it. */
async function pipMenuHasItem(page: Page): Promise<boolean> {
  await waitForContextMenuItemVisible(
    page,
    LAST_ITEM_FROM_END,
    E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
  );
  return page.evaluate(
    ({ menuSel, itemSel }) => {
      const doc = window.documentPictureInPicture?.window?.document;
      return Array.from(doc?.querySelectorAll<HTMLElement>(menuSel) ?? []).some(
        (m) => m.style.display !== 'none' && m.querySelector(itemSel) !== null
      );
    },
    { menuSel: E2E_SELECTORS.CONTEXT_MENU, itemSel: MENU_ITEM }
  );
}

test.describe('Open PiP from the page (context menu item, controls button)', () => {
  test('context menu item: shown first and fits → opens PiP → not in the PiP menu → back on the page after close', async ({
    videoPageReady: page,
    assertPiPWindowHasPlayer,
    waitForPiPAdToEnd,
  }) => {
    await rightClickPlayer(page, E2E_SELECTORS.MOVIE_PLAYER);
    await expect
      .poll(() => shownMenuOnPage(page), { timeout: E2E_WAIT_TIMEOUT_MS })
      .toEqual({ hasItem: true, firstIsItem: true, allItemsFit: true });
    const item = page.locator(MENU_ITEM);
    await expect(item).toHaveText(MENU_ITEM_LABEL);

    await item.click();
    await assertPiPWindowHasPlayer(page);
    // The page's menu closed with the click
    await expect.poll(() => shownMenuOnPage(page), { timeout: E2E_WAIT_TIMEOUT_MS }).toBeNull();

    await waitForPiPAdToEnd(page);
    expect(await pipMenuHasItem(page)).toBe(false);

    await closePiPAndWait(page);
    await page.locator(E2E_SELECTORS.MOVIE_PLAYER).waitFor({ state: 'visible' });
    // After PiP the item is back in the page's menu, and the menu is still sized for it
    await rightClickPlayer(page, E2E_SELECTORS.MOVIE_PLAYER);
    await expect
      .poll(() => shownMenuOnPage(page), { timeout: E2E_WAIT_TIMEOUT_MS })
      .toEqual({ hasItem: true, firstIsItem: true, allItemsFit: true });
  });

  test('context menu item in the mini player opens PiP', async ({
    videoPageReady: page,
    assertPiPWindowHasPlayer,
  }) => {
    await page.keyboard.press('i');
    await page.locator(E2E_SELECTORS.MINIPLAYER_HOST).waitFor({ state: 'visible' });

    await rightClickPlayer(page, E2E_SELECTORS.MINIPLAYER_HOST);
    await expect
      .poll(() => shownMenuOnPage(page), { timeout: E2E_WAIT_TIMEOUT_MS })
      .toEqual({ hasItem: true, firstIsItem: true, allItemsFit: true });
    await page.locator(MENU_ITEM).click();
    await assertPiPWindowHasPlayer(page);

    await closePiPAndWait(page);
    await page.locator(E2E_SELECTORS.MINIPLAYER_HOST).waitFor({ state: 'visible' });
  });

  test('controls button: next to the settings → opens PiP → hidden in the PiP window', async ({
    videoPageReady: page,
    assertPiPWindowHasPlayer,
  }) => {
    const player = page.locator(E2E_SELECTORS.MOVIE_PLAYER);
    await player.hover();
    const button = page.locator(`${E2E_SELECTORS.MOVIE_PLAYER} ${CONTROLS_BUTTON}`);
    await expect(button).toBeVisible({ timeout: E2E_WAIT_TIMEOUT_MS });
    expect(
      await button.evaluate((b) => b.nextElementSibling?.matches('.ytp-settings-button') ?? false)
    ).toBe(true);

    await button.click();
    await assertPiPWindowHasPlayer(page);
    const shownInPip = await page.evaluate((sel) => {
      const pip = window.documentPictureInPicture?.window;
      const b = pip?.document.querySelector<HTMLElement>(sel);
      return b ? pip!.getComputedStyle(b).display !== 'none' : false;
    }, CONTROLS_BUTTON);
    expect(shownInPip).toBe(false);

    await closePiPAndWait(page);
    await player.hover();
    await expect(button).toBeVisible({ timeout: E2E_WAIT_TIMEOUT_MS });
  });
});
