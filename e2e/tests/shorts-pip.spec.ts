/**
 * E2E: Shorts in PiP popup.
 *
 * Flow:
 *  - open Shorts feed page
 *  - open PiP via media session handler
 *  - in PiP: verify Shorts player container is present
 *  - close PiP window
 *  - verify Shorts player container is present back on the main page
 */
import {
  test,
  waitForShortsPlayerVisibleInMain,
  waitForShortsPlayerVisibleInPip,
} from '../fixtures';
import { E2E_WAIT_TIMEOUT_MS, SKIP_AUTH_E2E_ON_CI } from '../constants';

(SKIP_AUTH_E2E_ON_CI ? test.describe.skip : test.describe)('Shorts in PiP popup', () => {
  test.use({ authState: true });

  test('Shorts page → open PiP → Shorts player in PiP → close → Shorts player back on page', async ({
    shortsPageReady: page,
    triggerEnterPictureInPicture,
  }) => {
    // Ensure Shorts player is present on the main page before opening PiP.
    await waitForShortsPlayerVisibleInMain(page);

    // Open PiP via Media Session handler and assert base player presence in PiP.
    await triggerEnterPictureInPicture(page);

    // Verify Shorts-specific player container exists inside the PiP window.
    await waitForShortsPlayerVisibleInPip(page);

    // Close PiP window.
    await page.evaluate(() => window.documentPictureInPicture?.window?.close());
    await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });

    // After closing PiP, Shorts player container should be back on the main page.
    await waitForShortsPlayerVisibleInMain(page);
  });
});
