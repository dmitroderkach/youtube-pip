// TEMPORARY (not committed): what UI does YouTube show after "Copy video URL" from the context menu on the page?
import { test } from '../fixtures';

test('debug: copy feedback on page', async ({ videoPageReady: page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('i');
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __copyLog: string[] }).__copyLog = log;
    const t0 = performance.now();
    new MutationObserver((recs) => {
      for (const r of recs) {
        const el = (r.type === 'childList' ? r.addedNodes[0] : r.target) as HTMLElement | undefined;
        if (!(el instanceof HTMLElement)) continue;
        const text = (el.innerText || '').trim().slice(0, 80);
        if (
          /copied|скопійовано|clipboard|копі/i.test(text) ||
          /toast|notification|tooltip|bezel|copied/i.test(el.className + ' ' + el.tagName)
        )
          log.push(
            `${Math.round(performance.now() - t0)}ms ${r.type} ${el.tagName}.${String(el.className).slice(0, 80)} "${text}" vis=${el.offsetParent !== null}`
          );
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden'],
    });
  });
  const box = await page.locator('ytd-miniplayer #movie_player').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' });
  await page.waitForTimeout(600);
  const items = page.locator('.ytp-contextmenu:visible .ytp-panel-menu > .ytp-menuitem');
  const n = await items.count();
  const labels = await items.allInnerTexts();
  console.log('menu items:', labels.join(' | '));
  await items.nth(n - 1 - 5).click();
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: '/private/tmp/claude-501/-Users-dmytroderkach-youtube-pip/4d18e712-ad93-4541-b989-4f41cddcce9b/scratchpad/frames/copy-page.png',
  });
  console.log('clipboard:', await page.evaluate(() => navigator.clipboard.readText()));
  console.log(
    (await page.evaluate(() => (window as unknown as { __copyLog: string[] }).__copyLog)).join('\n')
  );
});
