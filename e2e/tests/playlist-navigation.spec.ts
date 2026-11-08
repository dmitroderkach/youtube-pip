/**
 * E2E: Navigation when switching video from playlist inside the PiP popup.
 *
 * Flow: open playlist video → open PiP popup → in popup: expand playlist → click another video
 *       → assert the clicked item has attribute selected → close PiP → player back on the page; the tab title
 *       never shows anything but a video title (YouTube rewrites it while the mini player goes away).
 */
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { E2E_SELECTORS } from '../selectors';
import {
  clickExpandInPip,
  clickPlaylistItemInPip,
  expect,
  startPageTitleRecorder,
  stopPageTitleRecorder,
  test,
  waitForMiniPlayerVisibleInPip,
  waitForPlaylistItemSelectedInPip,
  waitForPlaylistItemVisibleInPip,
  waitForPlaylistPanelVisibleInPip,
} from '../fixtures';

test.describe('Playlist navigation in PiP popup', () => {
  test('playlist video → open PiP → expand → click another video → clicked item has selected', async ({
    playlistVideoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
  }) => {
    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);

    await waitForMiniPlayerVisibleInPip(page);
    await clickExpandInPip(page);
    await waitForPlaylistPanelVisibleInPip(page);
    await waitForPlaylistItemVisibleInPip(page, 1);

    await startPageTitleRecorder(page);
    await clickPlaylistItemInPip(page, 1);

    await waitForPlaylistItemSelectedInPip(page, 1);

    await page.evaluate(() => window.documentPictureInPicture?.window?.close());
    await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });
    await page.locator(E2E_SELECTORS.MOVIE_PLAYER).waitFor({ state: 'visible' });
    const titles = await stopPageTitleRecorder(page);
    expect(
      titles.filter((t) => !t.endsWith(' - YouTube')),
      `tab titles: ${titles.join(' → ')}`
    ).toEqual([]);
  });
});
