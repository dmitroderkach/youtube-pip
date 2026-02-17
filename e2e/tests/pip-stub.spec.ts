/**
 * E2E: Document PiP stub + real app on YouTube.
 *
 * Prerequisites: npm run build (dist/userscript.js must exist).
 * Stubs (handler + PiP) are applied via fixtures — every page load gets them.
 *
 * Flow: videoPageReady (goto video → consent → inject userscript → wait for handler)
 *       → trigger PiP → assert PiP window has player → close PiP → assert player back on page.
 */
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { test } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

test.describe('PiP with document PiP stub', () => {
  test('happy flow: open PiP → player in PiP → close PiP → player back on page', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
  }) => {
    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);
    await page.evaluate(() => window.documentPictureInPicture?.window?.close());
    await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });
    await page.locator(E2E_SELECTORS.MOVIE_PLAYER).waitFor({ state: 'visible' });
  });
});
