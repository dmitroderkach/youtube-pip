/**
 * E2E: Context menu copy actions in PiP (copy video URL, URL at time, embed iframe, debug info).
 *
 * Ads may show first, so not all menu items are visible immediately — we wait for each
 * item to become visible with an extended timeout before clicking and asserting clipboard.
 */
import { clickContextMenuItem, expect, test, waitForContextMenuItemVisible } from '../fixtures';
import { E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS, E2E_WAIT_TIMEOUT_MS } from '../constants';

const COPY_MENU_INDICES = { VIDEO_URL: 2, URL_AT_TIME: 3, EMBED: 4, DEBUG_INFO: 5 } as const;

test.describe('Context menu copy in PiP', () => {
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

    await page.waitForTimeout(5000); // wait for video current time to be updated
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
