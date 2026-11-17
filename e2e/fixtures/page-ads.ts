import type { Page } from '@playwright/test';
import {
  E2E_PIP_AD_MAX_WAIT_MS,
  E2E_PIP_AD_STABILITY_MS,
  E2E_PIP_SKIP_AD_POLL_MS,
} from '../constants';
import { E2E_SELECTORS } from '../selectors';

/**
 * Waits until no player on the page shows an ad (`ad-showing`), clicking a visible skip button meanwhile; one deadline
 * for all ads in a row. The page's context menu is not ours while an ad plays (seen on the daily on-call: the item
 * never showed while a pre-roll ran from 2 s to 19 s), so the context menu tests right-click only after this.
 */
export async function waitForPageAdToEnd(page: Page): Promise<void> {
  const deadline = Date.now() + E2E_PIP_AD_MAX_WAIT_MS;
  const adShowing = (selector: string) => document.querySelector(selector) !== null;
  for (;;) {
    if (!(await page.evaluate(adShowing, E2E_SELECTORS.AD_SHOWING_PLAYER))) {
      // An ad that ends can be followed by the next one: the page must stay ad-free for a moment
      await page.waitForTimeout(E2E_PIP_AD_STABILITY_MS);
      if (!(await page.evaluate(adShowing, E2E_SELECTORS.AD_SHOWING_PLAYER))) return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Ads on the page did not end within ${E2E_PIP_AD_MAX_WAIT_MS}ms`);
    }
    // First visible one: with several matches isVisible() would throw (strict) and read as "not visible"
    const skip = page.locator(`${E2E_SELECTORS.SKIP_AD_BUTTON} >> visible=true`).first();
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
    await page.waitForTimeout(E2E_PIP_SKIP_AD_POLL_MS);
  }
}
