/**
 * E2E: Context menu copy actions in PiP (copy video URL, URL at time, embed iframe, debug info).
 *
 * Ads may show first, so not all menu items are visible immediately — we wait for each
 * item to become visible with an extended timeout before clicking and asserting clipboard.
 */
import {
  clickCopyMenuItemInPip,
  expect,
  test,
  waitForContextMenuItemVisible,
  waitForPlaybackTimeInPip,
} from '../fixtures';
import {
  COPY_MENU_POSITIONS_FROM_END,
  E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
  E2E_MIN_PLAYBACK_TIME_FOR_URL_AT_TIME_S,
  E2E_WAIT_TIMEOUT_MS,
} from '../constants';

test.describe('Context menu copy in PiP', () => {
  test('copy video URL, URL at time, embed iframe, debug info work', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
    waitForPiPAdToEnd,
  }) => {
    // Page readiness + playback wait + four copy steps; waitForPiPAdToEnd adds the ad budget itself.
    test.setTimeout(105_000);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);
    await waitForPiPAdToEnd(page);

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_POSITIONS_FROM_END.VIDEO_URL,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickCopyMenuItemInPip(page, COPY_MENU_POSITIONS_FROM_END.VIDEO_URL);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/watch|youtu\.be/);

    const playback = await waitForPlaybackTimeInPip(page, E2E_MIN_PLAYBACK_TIME_FOR_URL_AT_TIME_S);
    if (!playback.reached) {
      // The copy itself is still checked (bezel, menu closed, URL); only the t= part needs playback.
      test.info().annotations.push({
        type: 'warning',
        description: `Video in PiP did not reach ${E2E_MIN_PLAYBACK_TIME_FOR_URL_AT_TIME_S}s (${playback.state}); t= not checked`,
      });
    }
    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_POSITIONS_FROM_END.URL_AT_TIME,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickCopyMenuItemInPip(page, COPY_MENU_POSITIONS_FROM_END.URL_AT_TIME);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/watch|youtu\.be/);
    if (playback.reached) {
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
          timeout: E2E_WAIT_TIMEOUT_MS,
        })
        .toMatch(/[?&]t=|\?t=/);
    }

    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_POSITIONS_FROM_END.EMBED,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickCopyMenuItemInPip(page, COPY_MENU_POSITIONS_FROM_END.EMBED);
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
      COPY_MENU_POSITIONS_FROM_END.DEBUG_INFO,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    await clickCopyMenuItemInPip(page, COPY_MENU_POSITIONS_FROM_END.DEBUG_INFO);
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
