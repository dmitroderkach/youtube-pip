/**
 * E2E: Document PiP stub + real app on YouTube.
 *
 * Prerequisites: npm run build (dist/userscript.js must exist).
 * Stubs (handler + PiP) are applied via fixtures — every page load gets them.
 *
 * Flow:
 * 1. Go to YouTube → accept consent → inject userscript → wait 5s
 * 2. Go to video page → accept consent → inject userscript
 * 3. Trigger enterpictureinpicture → assert PiP iframe
 */
import { test } from './fixtures';

test.describe('PiP with document PiP stub', () => {
  test('happy flow: open PiP → player in PiP → close PiP → player back on page', async ({
    videoPageReady: page,
    triggerEnterPictureInPicture,
  }) => {
    await triggerEnterPictureInPicture(page);

    await page.waitForFunction(
      () => {
        const pipWindow = window.documentPictureInPicture?.window;
        if (!pipWindow?.document) return false;
        return !!(
          pipWindow.document.querySelector('ytd-app') &&
          pipWindow.document.querySelector('#movie_player')
        );
      },
      { timeout: 20000 }
    );

    await page.evaluate(() => window.documentPictureInPicture?.window?.close());

    await page.waitForFunction(() => window.documentPictureInPicture?.window == null, {
      timeout: 10000,
    });

    await page.waitForFunction(
      () => {
        const player = document.querySelector('#movie_player');
        return !!player && document.contains(player);
      },
      { timeout: 15000 }
    );
  });
});
