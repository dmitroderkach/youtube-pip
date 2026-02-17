/**
 * E2E: PiP from mini player — press "i", wait for mini player, open PiP, close, assert mini player visible again.
 */
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { test } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

test.describe('PiP from mini player', () => {
  test('press "i" → wait mini player → open PiP → assert → close PiP → mini player visible again', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
  }) => {
    await page.keyboard.press('i');
    await page.locator(E2E_SELECTORS.MINIPLAYER_HOST).waitFor({ state: 'visible' });

    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);
    await page.evaluate(() => window.documentPictureInPicture?.window?.close());
    await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });

    await page.locator(E2E_SELECTORS.MINIPLAYER_HOST).waitFor({ state: 'visible' });
  });
});
