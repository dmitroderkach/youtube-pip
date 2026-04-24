/**
 * E2E: Like / remove like / dislike / remove dislike inside the PiP popup.
 * Opens PiP first, then runs like/dislike flow in popup context; asserts via network.
 */
import {
  clickExpandInPip,
  clickLikeDislikeInPip,
  test,
  waitForLikeButtonsVisibleInPip,
  waitForMiniPlayerVisibleInPip,
  waitForPlaylistItemVisibleInPip,
  waitForPlaylistPanelVisibleInPip,
} from '../fixtures';
import { E2E_WAIT_TIMEOUT_MS } from '../constants';

const LIKE_LIKE_URL = 'https://www.youtube.com/youtubei/v1/like/like?prettyPrint=false';
const LIKE_REMOVELIKE_URL = 'https://www.youtube.com/youtubei/v1/like/removelike?prettyPrint=false';
const LIKE_DISLIKE_URL = 'https://www.youtube.com/youtubei/v1/like/dislike?prettyPrint=false';

test.describe('Like / dislike in PiP popup (auth, network)', () => {
  test.use({ authState: true });

  test('open PiP → like → remove like → dislike → remove dislike triggers correct API requests', async ({
    playlistVideoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
  }) => {
    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);

    await waitForMiniPlayerVisibleInPip(page);
    await clickExpandInPip(page);
    await waitForPlaylistPanelVisibleInPip(page);
    await waitForPlaylistItemVisibleInPip(page, 0);
    await waitForLikeButtonsVisibleInPip(page);

    // 1) Like
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url() === LIKE_LIKE_URL,
        { timeout: E2E_WAIT_TIMEOUT_MS }
      ),
      clickLikeDislikeInPip(page, 'LIKE'),
    ]);

    // 2) Remove like
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url() === LIKE_REMOVELIKE_URL,
        { timeout: E2E_WAIT_TIMEOUT_MS }
      ),
      clickLikeDislikeInPip(page, 'REMOVE_LIKE'),
    ]);

    // 3) Dislike
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url() === LIKE_DISLIKE_URL,
        { timeout: E2E_WAIT_TIMEOUT_MS }
      ),
      clickLikeDislikeInPip(page, 'DISLIKE'),
    ]);

    // 4) Remove dislike (same removelike endpoint)
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url() === LIKE_REMOVELIKE_URL,
        { timeout: E2E_WAIT_TIMEOUT_MS }
      ),
      clickLikeDislikeInPip(page, 'REMOVE_DISLIKE'),
    ]);
  });
});
