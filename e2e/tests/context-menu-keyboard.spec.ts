/**
 * E2E: the player context menu in PiP works from the keyboard, as on the page.
 *
 * Keys pressed in PiP are forwarded to the player unless a player menu is open. Menus YouTube opens in PiP
 * itself (web_watch_pip / web_shorts_pip: chromium-yt-pip, chromium-all-flags) were not seen as open, so arrows
 * and Enter went to the player instead of the menu. Runs in the whole flag matrix.
 */
import {
  expect,
  focusContextMenuItemInPip,
  focusedContextMenuItemPositionInPip,
  test,
  waitForContextMenuItemVisible,
  waitForCopyFeedbackInPip,
  watchCopiedBezelInPip,
} from '../fixtures';
import {
  COPY_MENU_POSITIONS_FROM_END,
  E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS,
  E2E_WAIT_TIMEOUT_MS,
} from '../constants';

test.describe('Context menu keyboard in PiP', () => {
  test('ArrowDown moves to the next item, Enter activates it (copy with feedback)', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
    waitForPiPAdToEnd,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText(''));

    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);
    await waitForPiPAdToEnd(page);
    await waitForContextMenuItemVisible(
      page,
      COPY_MENU_POSITIONS_FROM_END.VIDEO_URL,
      E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS
    );
    const pipPage = page
      .context()
      .pages()
      .find((p) => p !== page);
    expect(pipPage, 'PiP page').toBeTruthy();

    expect(await focusContextMenuItemInPip(page, COPY_MENU_POSITIONS_FROM_END.VIDEO_URL)).toBe(
      true
    );
    await pipPage!.keyboard.press('ArrowDown');
    await expect
      .poll(() => focusedContextMenuItemPositionInPip(page), { timeout: E2E_WAIT_TIMEOUT_MS })
      .toBe(COPY_MENU_POSITIONS_FROM_END.URL_AT_TIME);

    await watchCopiedBezelInPip(page);
    await pipPage!.keyboard.press('Enter');
    await waitForCopyFeedbackInPip(page);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: E2E_WAIT_TIMEOUT_MS,
      })
      .toMatch(/youtube\.com\/watch|youtu\.be/);
  });
});
