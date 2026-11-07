/**
 * E2E: Document PiP stub + real app on YouTube.
 *
 * Prerequisites: npm run build (dist/userscript.js must exist).
 * Stubs (handler + PiP) are applied via fixtures — every page load gets them.
 *
 * Flow: videoPageReady (goto video → consent → inject userscript → wait for handler)
 *       → trigger PiP → assert PiP window has player (tab title kept, no flicker to "YouTube")
 *       → close PiP → assert player back on page.
 */
import { E2E_WAIT_TIMEOUT_MS } from '../constants';
import { expect, startPageTitleRecorder, stopPageTitleRecorder, test } from '../fixtures';
import { E2E_SELECTORS } from '../selectors';

test.describe('PiP with document PiP stub', () => {
  test('happy flow: open PiP → player in PiP → close PiP → player back on page', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
    assertPiPWindowHasPlayer,
  }) => {
    await startPageTitleRecorder(page);
    await triggerEnterPictureInPicture(page);
    await assertPiPWindowHasPlayer(page);
    // Activating the mini player makes YouTube set the title "YouTube"; the userscript keeps the video title
    const titles = await stopPageTitleRecorder(page);
    expect(
      titles.filter((t) => !t.endsWith(' - YouTube')),
      `tab titles: ${titles.join(' → ')}`
    ).toEqual([]);
    await page.evaluate(() => window.documentPictureInPicture?.window?.close());
    await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
      timeout: E2E_WAIT_TIMEOUT_MS,
    });
    await page.locator(E2E_SELECTORS.MOVIE_PLAYER).waitFor({ state: 'visible' });
  });
});
