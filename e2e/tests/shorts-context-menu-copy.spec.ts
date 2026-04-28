/**
 * E2E: Context menu copy actions in Shorts PiP (copy video URL, URL at time, embed iframe, debug info).
 *
 * Flow: open Shorts page → open PiP → wait for Shorts player in PiP → wait for ads to finish
 *       → for each menu item (URL, URL at time, embed, debug info):
 *         open context menu in PiP, click item, assert clipboard contents.
 */
import {
  clickContextMenuItem,
  expect,
  test,
  waitForContextMenuItemVisible,
  waitForShortsPlayerVisibleInPip,
} from '../fixtures';
import { E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS, E2E_WAIT_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';

const COPY_MENU_INDICES = { VIDEO_URL: 2, URL_AT_TIME: 3, EMBED: 4, DEBUG_INFO: 5 } as const;

test.describe('Context menu copy in Shorts PiP', () => {
  test.use({ authState: true });

  test('Shorts page → open PiP → context menu copy items work', async ({
    shortsPageReady: page,
    triggerEnterPictureInPicture,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await triggerEnterPictureInPicture(page);
    await waitForShortsPlayerVisibleInPip(page);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_INDICES.VIDEO_URL,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
      E2E_SELECTORS.SHORTS_PLAYER
    );
    await clickContextMenuItem(page, COPY_MENU_INDICES.VIDEO_URL);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/https:\/\/www\.youtube\.com\/shorts\/.+\?feature=share/);

    await page.waitForTimeout(5000); // wait for video current time to be updated
    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_INDICES.URL_AT_TIME,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
      E2E_SELECTORS.SHORTS_PLAYER
    );
    await clickContextMenuItem(page, COPY_MENU_INDICES.URL_AT_TIME);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/https:\/\/www\.youtube\.com\/shorts\/.+\?t=\d+&feature=share/);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/\?t=\d+&feature=share/);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_INDICES.EMBED,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
      E2E_SELECTORS.SHORTS_PLAYER
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
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
      E2E_SELECTORS.SHORTS_PLAYER
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
