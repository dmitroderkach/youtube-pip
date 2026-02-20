/**
 * E2E: Navigation when switching video from mini player playlist.
 *
 * Flow: open playlist video (in the middle of playlist) → open mini player (press "i")
 *       → click expand to show playlist list → click another video → assert navigation.
 *
 * PiP is not opened; the test uses only the mini player (our popup contains the same structure).
 */
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { test } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

test.describe('Playlist navigation in mini player', () => {
  test('playlist video → open mini player → expand → click another video → video changes', async ({
    playlistVideoPageReady: page,
  }) => {
    await page.keyboard.press('i');
    await page
      .locator(E2E_SELECTORS.MINIPLAYER_HOST)
      .waitFor({ state: 'visible', timeout: E2E_WAIT_TIMEOUT_MS });

    const miniPlayer = page.locator(E2E_SELECTORS.MINIPLAYER_HOST);
    const expandButton = miniPlayer.locator(E2E_SELECTORS.MENU_BUTTON).first();
    await expandButton.click();
    await miniPlayer
      .locator(E2E_SELECTORS.PLAYLIST_PANEL)
      .waitFor({ state: 'visible', timeout: E2E_WAIT_TIMEOUT_MS });

    const playlistItems = miniPlayer.locator(E2E_SELECTORS.PLAYLIST_VIDEO_ITEM);
    await playlistItems.nth(1).waitFor({ state: 'visible', timeout: E2E_WAIT_TIMEOUT_MS });

    const video = miniPlayer.locator('video').first();
    const initialSrc =
      (await video.getAttribute('src')) ??
      (await video.evaluate((el: HTMLVideoElement) => el.currentSrc || ''));

    await playlistItems.nth(1).click();

    await page.waitForFunction(
      ({ hostSelector, prevSrc }: { hostSelector: string; prevSrc: string }) => {
        const container = document.querySelector(hostSelector);
        const v = container?.querySelector('video');
        const current =
          v?.getAttribute('src') ?? (v as HTMLVideoElement | undefined)?.currentSrc ?? '';
        return !!v && current !== prevSrc;
      },
      { hostSelector: E2E_SELECTORS.MINIPLAYER_HOST, prevSrc: initialSrc },
      { timeout: E2E_WAIT_TIMEOUT_MS }
    );
  });
});
