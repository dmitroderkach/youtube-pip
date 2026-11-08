/**
 * TEMPORARY (release/2.7.0): dumps the Shorts player controls, their tooltips and the "⋮" menu DOM as the logged-in
 * test account sees them (not rendered for anonymous sessions), to build the Shorts entry points. Remove before merge.
 */
import { test } from '../fixtures';

const strip = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<path[^>]*>(<\/path>)?/g, '')
    .replace(/ d="[^"]*"/g, '')
    .replace(/\s(style|nonce)="[^"]*"/g, '')
    .slice(0, 12000);

test.describe('Shorts DOM dump (temporary)', () => {
  test.use({ authState: true });

  test('dump', async ({ shortsPageReady: page }) => {
    const log = (tag: string, text: string) => console.log(`SHORTSDOM ${tag}: ${strip(text)}`);
    await page.waitForTimeout(3000);
    const player = page.locator('#shorts-player').first();
    const box = (await player.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.waitForTimeout(1000);
    log(
      'controls',
      await page.evaluate(() => {
        const c = document.querySelector('ytd-shorts-player-controls');
        return c
          ? c.outerHTML
          : `none; reel flags: ${Array.from(document.querySelectorAll('ytd-reel-video-renderer'))
              .map((r) => r.outerHTML.slice(0, 300))
              .join(' ## ')}`;
      })
    );
    const before = await page.evaluate(() => document.querySelectorAll('*').length);
    const fs = page.locator('ytd-shorts-player-controls #fullscreen-button-shape button').first();
    if (await fs.count()) {
      const fb = (await fs.boundingBox())!;
      await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await page.waitForTimeout(1200);
      log(
        'fullscreen-hover',
        await page.evaluate((n) => {
          const tips = Array.from(
            document.querySelectorAll(
              '[role=tooltip], tp-yt-paper-tooltip, [class*="ooltip" i], yt-tooltip'
            )
          ).filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0);
          return (
            `elements before=${n} after=${document.querySelectorAll('*').length} visible tooltips: ` +
            tips
              .map((t) => {
                const chain = [];
                let e: Element | null = t;
                for (let i = 0; i < 5 && e; i++) {
                  chain.push(
                    e.tagName.toLowerCase() +
                      (e.id ? '#' + e.id : '') +
                      (typeof e.className === 'string' && e.className
                        ? '.' + e.className.split(' ').slice(0, 3).join('.')
                        : '')
                  );
                  e = e.parentElement;
                }
                return `${chain.join(' < ')} :: ${t.outerHTML.slice(0, 600)}`;
              })
              .join(' ## ')
          );
        }, before)
      );
      log(
        'fullscreen-button',
        await fs.evaluate((b) => b.closest('#fullscreen-button-shape')!.outerHTML)
      );
    }
    const menuButton = page
      .locator(
        'ytd-shorts-player-controls #menu-button button, ytd-shorts-player-controls #menu-button [role=button]'
      )
      .first();
    if (await menuButton.count()) {
      await menuButton.click({ force: true });
      await page.waitForTimeout(1500);
      log(
        'menu-popup',
        await page.evaluate(() => {
          const dropdown = Array.from(
            document.querySelectorAll<HTMLElement>('ytd-popup-container tp-yt-iron-dropdown')
          ).find((d) => d.getBoundingClientRect().width > 0);
          if (!dropdown) return 'no visible dropdown';
          const items = Array.from(dropdown.querySelectorAll('*')).filter(
            (e) =>
              /item|menu-service|navigation/i.test(e.tagName) &&
              (e as HTMLElement).getBoundingClientRect().height > 0
          );
          const describe = (e: Element) =>
            `${e.tagName.toLowerCase()}.${typeof e.className === 'string' ? e.className : ''} "${e.textContent?.trim().slice(0, 40)}"`;
          return `ITEMS: ${items.map(describe).join(' | ')} ##### HTML: ${dropdown.querySelector('#contentWrapper')?.innerHTML ?? ''}`;
        })
      );
      await page.keyboard.press('Escape');
    } else {
      log('menu-popup', 'no #menu-button in controls');
    }
    const r = (await player.boundingBox())!;
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: 'right' });
    await page.waitForTimeout(800);
    log(
      'context-menu',
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('.ytp-contextmenu'))
          .filter((m) => (m as HTMLElement).style.display !== 'none')
          .map((m) =>
            Array.from(m.querySelectorAll('.ytp-menuitem'))
              .map((i) => i.textContent?.trim())
              .join(' | ')
          )
          .join(' ## ')
      )
    );
    log(
      'pip-mentions',
      await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            'ytd-shorts [class*="pip" i], ytd-shorts [aria-label*="picture" i]'
          )
        )
          .map((e) => e.tagName + '.' + (typeof e.className === 'string' ? e.className : ''))
          .slice(0, 20)
          .join(' | ')
      )
    );
  });
});
