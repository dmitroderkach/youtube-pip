/**
 * E2E: Shorts navigation inside PiP by scrolling to next reel.
 *
 * Flow:
 *  - open Shorts page
 *  - open PiP via media session handler
 *  - wait for Shorts player in PiP
 *  - capture current <video>.src inside Shorts player in PiP
 *  - scroll Shorts container to next reel
 *  - assert that <video>.src in Shorts player in PiP has changed
 */
import { scrollToNextShortInPip, test, waitForShortsPlayerVisibleInPip } from '../fixtures';
import { E2E_WAIT_TIMEOUT_MS, SKIP_AUTH_E2E_ON_CI } from '../constants';
import { E2E_SELECTORS } from '../selectors';

(SKIP_AUTH_E2E_ON_CI ? test.describe.skip : test.describe)('Shorts navigation in PiP', () => {
  test.use({ authState: true });

  test('Shorts page → open PiP → scroll to next Short → video src changes', async ({
    shortsPageReady: page,
    triggerEnterPictureInPicture,
  }) => {
    await triggerEnterPictureInPicture(page);
    await waitForShortsPlayerVisibleInPip(page);

    const initialSrc = await page.evaluate(
      ({
        shortsSel,
        playerSel,
        videoSel,
      }: {
        shortsSel: string;
        playerSel: string;
        videoSel: string;
      }) => {
        const pip = window.documentPictureInPicture?.window;
        const doc = pip?.document;
        const shorts = doc?.querySelector(shortsSel);
        const player = shorts?.querySelector(playerSel);
        const video = player?.querySelector<HTMLVideoElement>(videoSel);
        return video?.currentSrc || video?.src || null;
      },
      {
        shortsSel: E2E_SELECTORS.YTD_SHORTS,
        playerSel: E2E_SELECTORS.SHORTS_PLAYER,
        videoSel: E2E_SELECTORS.PLAYER_VIDEO,
      }
    );

    // lockLoadVideo in app uses IDLE_TIMEOUT 200ms before restoring loadVideo; +50ms buffer
    await page.waitForTimeout(250);

    await scrollToNextShortInPip(page);

    await test.expect
      .poll(
        () =>
          page.evaluate(
            ({
              shortsSel,
              playerSel,
              videoSel,
            }: {
              shortsSel: string;
              playerSel: string;
              videoSel: string;
            }) => {
              const pip = window.documentPictureInPicture?.window;
              const doc = pip?.document;
              const shorts = doc?.querySelector(shortsSel);
              const player = shorts?.querySelector(playerSel);
              const video = player?.querySelector<HTMLVideoElement>(videoSel);
              return video?.currentSrc || video?.src || null;
            },
            {
              shortsSel: E2E_SELECTORS.YTD_SHORTS,
              playerSel: E2E_SELECTORS.SHORTS_PLAYER,
              videoSel: E2E_SELECTORS.PLAYER_VIDEO,
            }
          ),
        { timeout: E2E_WAIT_TIMEOUT_MS }
      )
      .not.toBe(initialSrc);
  });
});
