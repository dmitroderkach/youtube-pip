/**
 * E2E: our own ways to open PiP from the page (src/ui/PiPEntryPoints.ts):
 * - the PiP item (YouTube's own PiP name) at the top of the player context menu (watch page and mini player),
 *   absent from the menu in the PiP window;
 * - the PiP button in the player controls, hidden in the PiP window.
 * Both are opened with real mouse clicks (a real user activation, as for the owner).
 */
import type { Page } from '@playwright/test';
import { E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS, E2E_WAIT_TIMEOUT_MS } from '../constants';
import {
  expect,
  test,
  waitForContextMenuItemVisible,
  waitForShortsPlayerVisibleInMain,
  waitForShortsPlayerVisibleInPip,
} from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

const MENU_ITEM = '.ytpip-open-menuitem';
const CONTROLS_BUTTON = '.ytpip-open-button';
const TOOLTIP = '.ytpip-tooltip';
const SHORTS_BUTTON = '.ytpip-shorts-button';
const SHORTS_MENU_ITEM = '.ytpip-shorts-menuitem';
/**
 * Our labels for the page languages the e2e runs see (src/i18n/dictionaries.ts); other languages are only checked
 * for a non-empty label.
 */
const LABELS: Readonly<Record<string, { menuItem: string; button: string }>> = {
  en: { menuItem: 'Picture-in-picture', button: 'Picture-in-picture' },
  uk: { menuItem: 'Картинка в картинці', button: 'Картинка в картинці' },
};

/** Our labels for the page's YouTube interface language (`ytcfg` HL), or null for a language not in LABELS. */
async function expectedLabels(page: Page): Promise<{ menuItem: string; button: string } | null> {
  const hl = await page.evaluate(() =>
    (window as Window & { ytcfg?: { get?: (k: string) => unknown } }).ytcfg?.get?.('HL')
  );
  return LABELS[String(hl ?? '')] ?? null;
}
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

/**
 * PiP entries of the shown page menu: ours, and YouTube's own (`web_watch_pip_context_menu_button`, label = YouTube's
 * PiP name) that must be hidden so only ours is offered.
 */
function pipItemsInShownMenu(page: Page, youtubeLabel: string) {
  return page.evaluate(
    ({ menuSel, itemSel, label }) => {
      const menu = Array.from(document.querySelectorAll<HTMLElement>(menuSel)).find(
        (m) => getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().height > 0
      );
      const visible = (el: HTMLElement) => el.getBoundingClientRect().height > 0;
      const items = Array.from(
        menu?.querySelectorAll<HTMLElement>('.ytp-panel-menu > .ytp-menuitem') ?? []
      );
      return {
        ours: items.filter((i) => i.matches(itemSel) && visible(i)).length,
        youtube: items.filter(
          (i) =>
            !i.matches(itemSel) &&
            visible(i) &&
            i.querySelector('.ytp-menuitem-label')?.textContent?.trim() === label
        ).length,
      };
    },
    { menuSel: E2E_SELECTORS.CONTEXT_MENU, itemSel: MENU_ITEM, label: youtubeLabel }
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
    const labels = await expectedLabels(page);
    if (labels) await expect(item).toHaveText(labels.menuItem);
    else await expect(item).not.toHaveText('');
    // Only our PiP entry: YouTube's own item (chromium-yt-pip / all-flags projects) is hidden
    if (labels) {
      expect(await pipItemsInShownMenu(page, labels.button)).toEqual({ ours: 1, youtube: 0 });
    }

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

  test('controls button: next to the settings, YouTube-style tooltip → opens PiP → hidden in the PiP window', async ({
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

    // YouTube-style tooltip above the button, no browser tooltip
    expect(await button.getAttribute('title')).toBeNull();
    await button.hover();
    const tooltip = page.locator(`${E2E_SELECTORS.MOVIE_PLAYER} ${TOOLTIP}`);
    await expect(tooltip).toBeVisible({ timeout: E2E_WAIT_TIMEOUT_MS });
    // Visible to the eye too: YouTube's CSS keeps a tooltip transparent unless it is shown the way the player shows it
    await expect(tooltip).toHaveCSS('opacity', '1', { timeout: E2E_WAIT_TIMEOUT_MS });
    const labels = await expectedLabels(page);
    // YouTube's PiP name with the key, as YouTube writes "Full screen (f)"
    if (labels) await expect(tooltip).toHaveText(`${labels.button} (p)`);
    else await expect(tooltip).not.toHaveText('');
    const placement = await page.evaluate(
      ({ tipSel, btnSel }) => {
        const tip = document.querySelector(tipSel)!.getBoundingClientRect();
        const btn = document.querySelector(btnSel)!.getBoundingClientRect();
        return {
          above: tip.bottom <= btn.top,
          centerOffset: Math.abs(tip.x + tip.width / 2 - (btn.x + btn.width / 2)),
        };
      },
      {
        tipSel: `${E2E_SELECTORS.MOVIE_PLAYER} ${TOOLTIP}`,
        btnSel: `${E2E_SELECTORS.MOVIE_PLAYER} ${CONTROLS_BUTTON}`,
      }
    );
    expect(placement.above).toBe(true);
    expect(placement.centerOffset).toBeLessThanOrEqual(RECT_SLACK_PX);
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden({ timeout: E2E_WAIT_TIMEOUT_MS });

    // Only our PiP button: YouTube's own (web_watch_pip) is hidden
    expect(
      await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>('#movie_player .ytp-pip-button');
        return b ? b.getBoundingClientRect().width > 0 : false;
      })
    ).toBe(false);

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

  test('hotkey: "p" on the page opens PiP, "p" in the PiP window closes it; ignored while typing', async ({
    videoPageReady: page,
    assertPiPWindowHasPlayer,
  }) => {
    // Typing "p" in the search box does not open PiP
    const search = page.locator('input[name="search_query"], yt-searchbox input').first();
    if (await search.isVisible().catch(() => false)) {
      await search.click();
      await page.keyboard.press('p');
      expect(await page.evaluate(() => window.documentPictureInPicture?.window == null)).toBe(true);
      await search.fill('');
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.press('p');
    await assertPiPWindowHasPlayer(page);

    // The open PiP window (an earlier one may have been closed and replaced)
    const pipPage = page
      .context()
      .pages()
      .filter((p) => p !== page && !p.isClosed())
      .pop();
    expect(pipPage).toBeDefined();
    // keydown closes the window, so the keyup of press() would hit a closed page
    await pipPage!.keyboard.down('p');
    await pipPage!.keyboard.up('p').catch(() => undefined);
    await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });
    await page.locator(E2E_SELECTORS.MOVIE_PLAYER).waitFor({ state: 'visible' });
  });
});

/** Shorts PiP opened: wait for the player in it, close it, wait for the player back on the page. */
async function closeShortsPiP(page: Page): Promise<void> {
  await waitForShortsPlayerVisibleInPip(page);
  await page.evaluate(() => window.documentPictureInPicture?.window?.close());
  await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
    timeout: E2E_WAIT_TIMEOUT_MS,
  });
  await waitForShortsPlayerVisibleInMain(page);
}

/** What the Shorts top controls look like now (for a failure message). */
function shortsControlsState(page: Page): Promise<string> {
  return page.evaluate((sel) => {
    const shown = (e: Element) => (e as HTMLElement).getBoundingClientRect().width > 0;
    const controls = Array.from(document.querySelectorAll('ytd-shorts-player-controls'));
    const fullscreen = Array.from(
      document.querySelectorAll('ytd-shorts-player-controls #fullscreen-button-shape')
    );
    const ours = Array.from(document.querySelectorAll(sel));
    return `controls ${controls.length} (${controls.filter(shown).length} shown), full screen ${fullscreen.length} (${fullscreen.filter(shown).length} shown), ours ${ours.length} (${ours.filter(shown).length} shown)`;
  }, SHORTS_BUTTON);
}

test.describe('Open PiP from Shorts (controls button, context menu item)', () => {
  test.use({ authState: true });

  test('Shorts: context menu has only our PiP item; the button left of full screen and the "⋮" menu item open PiP', async ({
    shortsPageReady: page,
  }) => {
    await waitForShortsPlayerVisibleInMain(page);
    const player = page.locator(E2E_SELECTORS.SHORTS_PLAYER).first();
    await player.hover();

    // Context menu of the Shorts player: our item first, no YouTube PiP item next to it
    await rightClickPlayer(page, E2E_SELECTORS.SHORTS_PLAYER);
    await expect
      .poll(() => shownMenuOnPage(page), { timeout: E2E_WAIT_TIMEOUT_MS })
      .toEqual({ hasItem: true, firstIsItem: true, allItemsFit: true });
    const labels = await expectedLabels(page);
    if (labels) {
      await expect(page.locator(MENU_ITEM)).toHaveText(labels.menuItem);
      expect(await pipItemsInShownMenu(page, labels.button)).toEqual({ ours: 1, youtube: 0 });
    }
    // Close the menu with a click outside the player
    await page.mouse.click(1, 1);

    // Top controls (signed-in layout): our button right before full screen. YouTube shows the controls on pointer
    // movement over the reel, so keep moving until the shown reel's button is there
    const button = page.locator(`${SHORTS_BUTTON} button >> visible=true`).first();
    const reel = (await player.boundingBox())!;
    let step = 0;
    await expect
      .poll(
        async () => {
          step = (step + 1) % 2;
          await page.mouse.move(reel.x + reel.width / 2 + step * 20, reel.y + reel.height / 4);
          return button.count();
        },
        { timeout: E2E_WAIT_TIMEOUT_MS }
      )
      .toBeGreaterThan(0)
      .catch(async (error: unknown) => {
        throw new Error(`${String(error)}\nShorts controls: ${await shortsControlsState(page)}`);
      });
    // Right after "⋮", i.e. left of full screen (when YouTube renders it)
    expect(
      await button.evaluate(
        (b) => b.closest('.ytpip-shorts-button')?.previousElementSibling?.id ?? ''
      )
    ).toBe('menu-button');
    if (labels) expect(await button.getAttribute('title')).toBe(`${labels.button} (p)`);
    await button.click();
    await closeShortsPiP(page);

    // "⋮" menu of the top controls: our item first, opens PiP
    await page.mouse.move(reel.x + reel.width / 2, reel.y + reel.height / 4);
    await page.mouse.move(reel.x + reel.width / 2 + 20, reel.y + reel.height / 4);
    await page
      .locator('ytd-shorts-player-controls #menu-button button >> visible=true')
      .first()
      .click();
    const menuItem = page.locator(`${SHORTS_MENU_ITEM} >> visible=true`).first();
    await expect(menuItem).toBeVisible({ timeout: E2E_WAIT_TIMEOUT_MS });
    if (labels) await expect(menuItem).toHaveText(labels.menuItem);
    expect(await menuItem.evaluate((i) => i.parentElement?.firstElementChild === i)).toBe(true);
    await menuItem.click();
    await closeShortsPiP(page);
  });
});
