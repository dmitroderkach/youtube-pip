/**
 * E2E: Navigation when switching video from playlist inside the PiP popup.
 *
 * Flow: open playlist video → open PiP popup → in popup: expand playlist → click another video
 *       → assert the clicked item has attribute selected.
 */
import {
  clickExpandInPip,
  clickPlaylistItemInPip,
  test,
  waitForMiniPlayerVisibleInPip,
  waitForPlaylistItemSelectedInPip,
  waitForPlaylistItemVisibleInPip,
  waitForPlaylistPanelVisibleInPip,
} from '../fixtures';

test.describe('Playlist navigation in PiP popup', () => {
  test.slow();

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

    await clickPlaylistItemInPip(page, 1);

    await waitForPlaylistItemSelectedInPip(page, 1);
  });
});
